/**
 * The wiki agent: after an absorb, fold the absorbed section (and the takeaway the user typed) into
 * the wiki. It reads the schema, the index and the pages that already cover this material, then
 * returns pages to create or extend. It only ever writes wiki pages.
 */
import type { StoredNote } from '../store'
import type { WikiPage, WikiPageKind, Absorbed } from '../../shared/types'
import { unitMarkdown } from '../sections'
import { listPages, readSchema, indexLines, writePage, rebuildIndex, appendLog, slugify, KINDS } from '../wiki'
import { tokens, scoreUnit, cut } from './context'
import { chat, type ChatMessage } from './openrouter'
import type { AiConfig } from './config'

const MAX_RELATED_PAGES = 6
const PAGE_CAP = 2500
const SECTION_CAP = 24000 // a whole note

const SYSTEM = `You maintain a personal wiki derived from one person's notes. You are the bookkeeper, not the author of their thinking: pages record what THEIR notes say, cite where, and quote their typed takeaways verbatim. Never add outside knowledge, never smooth over a contradiction, never invent a source.

You receive: the wiki SCHEMA (conventions, follow them), the INDEX (existing pages), the full text of RELATED pages, and one newly absorbed SOURCE section with the person's TAKEAWAY and the CONNECTIONS they kept.

Decide which pages to update and which (if any) to create. Prefer extending an existing page. Create a page only for a person, project, concept, topic or decision that will clearly recur. Rewrite each touched page in full (you are given its current text), keeping everything still true and adding what this source contributes. Keep pages short.

Citations: write [[Note Title#Section Heading]] exactly as given in SOURCE and CONNECTIONS. Every factual line needs one.

Respond ONLY with JSON:
{
  "pages": [
    { "slug": "kebab-case", "title": "…", "kind": "person|project|concept|topic|decision", "summary": "one line for the index", "body": "full markdown body of the page" }
  ],
  "log": "one line describing what changed"
}
Return an empty "pages" list if the source adds nothing worth a page.`

export interface IngestInput { note: StoredNote; section?: string; entry: Absorbed; insight?: string }

export function sourceRef(note: StoredNote, section?: string) {
  const title = note.title.trim() || 'Untitled'
  return section ? `${title}#${section}` : title
}

export function relatedPages(text: string, pages: WikiPage[], limit = MAX_RELATED_PAGES): WikiPage[] {
  const q = tokens(text)
  return pages
    .map((p) => ({ p, score: scoreUnit(q, `${p.title} ${p.summary} ${p.body}`) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p)
}

export async function buildIngestMessages(input: IngestInput): Promise<{ messages: ChatMessage[]; related: WikiPage[]; ref: string } | null> {
  const body = unitMarkdown(input.note.body, input.section)
  if (body === null || !body.trim()) return null
  const schema = await readSchema()
  const pages = await listPages()
  const ref = sourceRef(input.note, input.section)
  const related = relatedPages(`${ref} ${body} ${input.insight ?? ''} ${input.entry.links.join(' ')}`, pages)
  const packet = [
    `Today: ${new Date().toISOString().slice(0, 10)}`,
    'SCHEMA:', schema.trim(), '',
    pages.length ? 'INDEX:' : 'INDEX: (empty wiki)', indexLines(pages), '',
    related.length ? 'RELATED pages (current full text):' : 'RELATED pages: none',
    ...related.map((p) => `--- ${p.slug} (${p.kind}) · ${p.title} ---\n${cut(p.body.trim(), PAGE_CAP)}`), '',
    `SOURCE: [[${ref}]]${input.entry.date ? ` (absorbed ${input.entry.date})` : ''}`,
    cut(body.trim(), SECTION_CAP), '',
    input.insight ? `TAKEAWAY (the person's own words, quote verbatim): "${input.insight.trim()}"` : 'TAKEAWAY: none typed',
    input.entry.links.length ? `CONNECTIONS kept: ${input.entry.links.map((l) => `[[${l}]]`).join(', ')}` : 'CONNECTIONS kept: none',
    input.entry.tags.length ? `TAGS: ${input.entry.tags.map((t) => '#' + t).join(' ')}` : ''
  ].join('\n')
  return { messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: packet }], related, ref }
}

export function parseIngest(raw: string): { pages: Omit<WikiPage, 'updated' | 'sources'>[]; log: string } {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  try {
    const data = JSON.parse(text)
    const pages = (Array.isArray(data.pages) ? data.pages : [])
      .filter((p: unknown) => p && typeof p === 'object')
      .map((p: Record<string, unknown>) => ({
        slug: slugify(String(p.slug || p.title || '')),
        title: String(p.title ?? '').trim(),
        kind: (KINDS.includes(p.kind as WikiPageKind) ? p.kind : 'topic') as WikiPageKind,
        summary: String(p.summary ?? '').trim().split('\n')[0].slice(0, 200),
        body: String(p.body ?? '').trim()
      }))
      .filter((p: { title: string; body: string }) => p.title && p.body)
    return { pages, log: typeof data.log === 'string' ? data.log.trim() : '' }
  } catch {
    return { pages: [], log: '' }
  }
}

/** Fold one absorbed unit into the wiki. Returns the slugs touched. */
export async function ingest(input: IngestInput, cfg: AiConfig): Promise<string[]> {
  const built = await buildIngestMessages(input)
  if (!built) return []
  const raw = await chat(cfg, built.messages, { json: true, maxTokens: 4000 })
  const { pages, log } = parseIngest(raw)
  const existing = new Map((await listPages()).map((p) => [p.slug, p]))
  const date = new Date().toISOString().slice(0, 10)
  const touched: string[] = []
  for (const p of pages) {
    const prev = existing.get(p.slug)
    await writePage({ ...p, sources: [...(prev?.sources ?? []), built.ref], updated: date })
    touched.push(p.slug)
  }
  await rebuildIndex()
  await appendLog('ingest', built.ref, log || (touched.length ? `touched: ${touched.join(', ')}` : 'nothing to add'))
  return touched
}
