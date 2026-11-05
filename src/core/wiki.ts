/**
 * The wiki: a derived layer of markdown pages the agent maintains from what you absorbed, in the
 * spirit of the "LLM wiki" pattern. Your notes are the raw sources and are never modified; the wiki
 * lives in NOTES_DIR/wiki and is the only place the agent writes prose.
 *
 *   wiki/WIKI.md      the schema: conventions the agent follows (yours to edit)
 *   wiki/index.md     catalog of pages, regenerated from frontmatter after every change
 *   wiki/log.md       append-only record of ingests and rebuilds
 *   wiki/pages/*.md   one page per person, project, concept or topic
 */
import { promises as fs } from 'fs'
import { join } from 'path'
import matter from 'gray-matter'
import { NOTES_DIR } from './paths'
import type { WikiPage, WikiPageKind } from '../shared/types'

export const WIKI_DIR = join(NOTES_DIR, 'wiki')
export const PAGES_DIR = join(WIKI_DIR, 'pages')
export const SCHEMA_FILE = join(WIKI_DIR, 'WIKI.md')
export const INDEX_FILE = join(WIKI_DIR, 'index.md')
export const LOG_FILE = join(WIKI_DIR, 'log.md')

export const KINDS: WikiPageKind[] = ['person', 'project', 'concept', 'topic', 'decision']
const KIND_LABEL: Record<WikiPageKind, string> = { person: 'People', project: 'Projects', concept: 'Concepts', topic: 'Topics', decision: 'Decisions' }

export const DEFAULT_SCHEMA = `# Wiki schema

This folder is a wiki the agent maintains from my notes. My notes (the markdown files one level up) are
the raw sources: they are mine and are never edited by the agent. Pages here are derived from the
sections I have absorbed and the takeaways I typed when absorbing them.

## Pages

- One page per person, project, concept, topic or decision. File name is the slug, frontmatter has
  \`title\`, \`kind\`, \`sources\` (the note sections it draws on) and \`updated\`.
- A page states only what my notes say. No outside knowledge. When my notes disagree with each other,
  say so and cite both; never silently pick one.
- Cite the section every claim comes from as [[Note#Section]]. My typed takeaways are quoted verbatim.
- Extend an existing page rather than creating a near-duplicate. Create a page only for something
  that will come up again.
- Short. A page is a few paragraphs or a list, not an essay. Lead with what I decided or believe,
  then the context, then open questions.

## Index and log

- index.md is regenerated automatically from page frontmatter; do not edit it by hand.
- log.md is append-only: one line per ingest or rebuild, prefixed \`## [YYYY-MM-DD] ingest | ...\`.
`

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page'

export async function ensureWiki() {
  await fs.mkdir(PAGES_DIR, { recursive: true })
  try { await fs.access(SCHEMA_FILE) } catch { await fs.writeFile(SCHEMA_FILE, DEFAULT_SCHEMA, 'utf8') }
  try { await fs.access(LOG_FILE) } catch { await fs.writeFile(LOG_FILE, '# Wiki log\n', 'utf8') }
}

export async function readSchema(): Promise<string> {
  await ensureWiki()
  return fs.readFile(SCHEMA_FILE, 'utf8')
}

function parsePage(raw: string, slug: string): WikiPage {
  const { data, content } = matter(raw)
  const kind = KINDS.includes(data.kind) ? (data.kind as WikiPageKind) : 'topic'
  const updated = data.updated instanceof Date ? data.updated.toISOString().slice(0, 10) : String(data.updated ?? '').slice(0, 10)
  return {
    slug,
    title: String(data.title ?? slug),
    kind,
    sources: Array.isArray(data.sources) ? data.sources.map(String) : [],
    updated: /^\d{4}-\d{2}-\d{2}$/.test(updated) ? updated : '',
    summary: String(data.summary ?? ''),
    body: content.replace(/^\n+/, '')
  }
}

export async function listPages(): Promise<WikiPage[]> {
  await ensureWiki()
  const files = (await fs.readdir(PAGES_DIR)).filter((f) => f.endsWith('.md'))
  const out: WikiPage[] = []
  for (const f of files) {
    try { out.push(parsePage(await fs.readFile(join(PAGES_DIR, f), 'utf8'), f.replace(/\.md$/, ''))) } catch (e) { console.error('bad wiki page', f, e) }
  }
  return out.sort((a, b) => (b.updated > a.updated ? 1 : b.updated < a.updated ? -1 : a.title.localeCompare(b.title)))
}

export async function readPage(slug: string): Promise<WikiPage | null> {
  try { return parsePage(await fs.readFile(join(PAGES_DIR, `${slugify(slug)}.md`), 'utf8'), slugify(slug)) } catch { return null }
}

export async function writePage(p: Omit<WikiPage, 'slug'> & { slug?: string }): Promise<WikiPage> {
  await ensureWiki()
  const slug = slugify(p.slug ?? p.title)
  const fm = { title: p.title, kind: p.kind, summary: p.summary, sources: [...new Set(p.sources)], updated: p.updated }
  const raw = matter.stringify('\n' + p.body.replace(/\s+$/, '') + '\n', fm)
  const target = join(PAGES_DIR, `${slug}.md`)
  await fs.writeFile(target + '.tmp', raw, 'utf8')
  await fs.rename(target + '.tmp', target)
  return { ...p, slug, sources: fm.sources }
}

/** Regenerate index.md: pages by kind, each with its one-line summary. The agent reads this first. */
export async function rebuildIndex(): Promise<string> {
  const pages = await listPages()
  const lines = ['# Wiki index', '', `${pages.length} page${pages.length === 1 ? '' : 's'}. Regenerated automatically; edit the pages, not this file.`, '']
  for (const k of KINDS) {
    const mine = pages.filter((p) => p.kind === k).sort((a, b) => a.title.localeCompare(b.title))
    if (!mine.length) continue
    lines.push(`## ${KIND_LABEL[k]}`, '')
    for (const p of mine) lines.push(`- [[wiki/pages/${p.slug}|${p.title}]] — ${p.summary || '(no summary)'}${p.updated ? ` · ${p.updated}` : ''}`)
    lines.push('')
  }
  const text = lines.join('\n')
  await fs.writeFile(INDEX_FILE, text, 'utf8')
  return text
}

/** Compact index for prompts: one line per page. */
export function indexLines(pages: WikiPage[]): string {
  return pages.map((p) => `- ${p.slug} (${p.kind}): ${p.title} — ${p.summary || ''}`).join('\n')
}

export async function appendLog(kind: 'ingest' | 'rebuild' | 'lint', what: string, detail?: string) {
  await ensureWiki()
  const date = new Date().toISOString().slice(0, 10)
  const line = `## [${date}] ${kind} | ${what}${detail ? `\n${detail}` : ''}\n\n`
  await fs.appendFile(LOG_FILE, line, 'utf8')
}

export async function readLog(limit = 50): Promise<string> {
  await ensureWiki()
  const raw = await fs.readFile(LOG_FILE, 'utf8')
  const entries = raw.split(/\n(?=## \[)/).filter((e) => e.startsWith('## ['))
  return entries.slice(-limit).join('\n')
}

// ---------- which absorbed units have been folded in ----------
const STATE_FILE = join(WIKI_DIR, '.ingested.json')

export async function readIngested(): Promise<Record<string, string>> {
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')) } catch { return {} }
}

export async function markIngested(ref: string) {
  await ensureWiki()
  const st = await readIngested()
  st[ref] = new Date().toISOString().slice(0, 10)
  await fs.writeFile(STATE_FILE, JSON.stringify(st, null, 2), 'utf8')
}

export async function clearIngested() {
  await fs.rm(STATE_FILE, { force: true })
}
