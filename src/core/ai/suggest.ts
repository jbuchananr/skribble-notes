/**
 * The connections agent: given one unit, propose where it connects in the brain. It never writes the
 * note. It returns candidate links (only to sections it was actually shown), tags already in use,
 * and at most one verbatim sentence it would call the takeaway, which the UI shows as a prompt.
 */
import type { SuggestRequest, Suggestion, Connection } from '../../shared/types'
import type { StoredNote } from '../store'
import { buildGraph } from '../graph'
import { wikilinkTarget } from '../absorb'
import { unitsOf, relatedSections } from './context'
import { chat, type ChatMessage } from './openrouter'
import type { AiConfig } from './config'

const MAX_CANDIDATES = 10
const SECTION_CAP = 12000 // a whole note
const MAX_TAGS_SHOWN = 40

const SYSTEM = `You file sections of a person's notes into their personal knowledge graph. You are a librarian, not an author: you never rewrite or summarize their notes, you only say what connects to what.

You get one FOCUS section and a numbered list of CANDIDATE sections from their other notes. Decide which candidates genuinely connect to the focus: same decision revisited, same person or project, an earlier thought this one extends or contradicts, a commitment this follows up on. Topical word overlap alone is not a connection.

Rules:
- Only reference candidates by their number. Never invent a target.
- Prefer 0-4 links. An empty list is a fine answer.
- "why" is one short sentence naming the specific connection, in plain words.
- Tags: reuse the person's existing tags where one clearly fits. Suggest a new tag only if the focus clearly introduces a recurring theme (a project, a person, a topic they will return to). 0-3 tags, lowercase, no spaces.
- "insight": if one sentence in the FOCUS reads like the takeaway, copy it verbatim (max 200 chars, single line). Otherwise empty string. Do not write your own.

Respond ONLY with JSON:
{ "links": [{ "ref": 1, "why": "…" }], "tags": ["…"], "insight": "…" }`

export function buildSuggestMessages(note: StoredNote, section: string | undefined, notes: StoredNote[]) {
  const units = unitsOf(note)
  const focus = section ? units.find((u) => u.heading === section) : units.find((u) => !u.heading) ?? units[0]
  const focusText = focus ? focus.text : note.body
  const candidates = relatedSections(focusText, note.id, section, notes, MAX_CANDIDATES)
  const tagCounts = new Map<string, number>()
  for (const n of notes) for (const t of [...n.tags, ...n.absorbed.flatMap((a) => a.tags)]) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_TAGS_SHOWN).map(([t]) => t)

  const packet = [
    `Today: ${new Date().toISOString().slice(0, 10)}`,
    `NOTE: ${note.title || 'Untitled'}`,
    section ? `FOCUS (section "${section}"):` : 'FOCUS (whole note):',
    focusText.trim().slice(0, SECTION_CAP),
    '',
    tags.length ? `EXISTING TAGS: ${tags.map((t) => '#' + t).join(' ')}` : 'EXISTING TAGS: none yet',
    '',
    candidates.length ? 'CANDIDATE sections from other notes:' : 'CANDIDATE sections: none found.',
    ...candidates.map((c, i) => `[${i + 1}] ${c.label}\n${c.text}`)
  ].join('\n')
  const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM }, { role: 'user', content: packet }]
  return { messages, candidates }
}

export function parseSuggestion(raw: string, candidates: { id: string; label: string }[], graph: ReturnType<typeof buildGraph>): Omit<Suggestion, 'context' | 'model'> {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  let data: Record<string, unknown> = {}
  try { data = JSON.parse(text) } catch { return { links: [], tags: [] } }
  const links: Connection[] = []
  const seen = new Set<string>()
  for (const l of Array.isArray(data.links) ? data.links : []) {
    if (!l || typeof l !== 'object') continue
    const ref = Number((l as Record<string, unknown>).ref)
    const c = candidates[ref - 1]
    if (!c) continue
    const node = graph.find((g) => g.id === c.id)
    const target = node ? wikilinkTarget(node) : null
    if (!target || seen.has(target)) continue
    seen.add(target)
    links.push({ target, label: c.label, why: String((l as Record<string, unknown>).why ?? '').trim() })
  }
  const tags = (Array.isArray(data.tags) ? data.tags : [])
    .map((t) => String(t).trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9/_-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter((t, i, a) => t && a.indexOf(t) === i)
    .slice(0, 3)
  const insight = typeof data.insight === 'string' ? data.insight.trim().split('\n')[0].slice(0, 200) : ''
  return { links, tags, insightQuote: insight || undefined }
}

export async function suggestConnections(req: SuggestRequest, notes: StoredNote[], cfg: AiConfig): Promise<Suggestion> {
  const note = notes.find((n) => n.id === req.noteId)
  if (!note) throw new Error('Note not found')
  const { messages, candidates } = buildSuggestMessages(note, req.section, notes)
  if (!candidates.length) return { links: [], tags: [], context: [], model: cfg.model }
  const raw = await chat(cfg, messages, { json: true, maxTokens: 800 })
  return { ...parseSuggestion(raw, candidates, buildGraph(notes)), context: candidates.map((c) => c.label), model: cfg.model }
}
