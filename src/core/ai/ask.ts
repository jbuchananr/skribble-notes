/**
 * Chat over the wiki: its pages first, then absorbed sections and insight cards. Notes you have not
 * absorbed are deliberately out of scope, so answers only ever come from thinking you have finished.
 */
import type { AskRequest, AskResult, AskSource, WikiPage } from '../../shared/types'
import type { StoredNote } from '../store'
import { buildGraph, isInsightsNote } from '../graph'
import { isUnit } from '../inbox'
import { unitsOf, tokens, scoreUnit, cut, RELATED_CAP, substance } from './context'
import { chat, type ChatMessage } from './openrouter'
import type { AiConfig } from './config'

const MAX_SOURCES = 8

export interface Passage { id: string; noteId?: string; section?: string; page?: string; label: string; text: string; absorbed?: string; kind: 'page' | 'unit' | 'insight' }

/** Everything askable: wiki pages, absorbed units, insight cards. */
export function wikiPassages(notes: StoredNote[], pages: WikiPage[]): Passage[] {
  const graph = buildGraph(notes)
  const out: Passage[] = pages.map((p) => ({ id: `wiki:${p.slug}`, page: p.slug, label: `Wiki › ${p.title}`, text: `${p.summary}\n\n${p.body}`, absorbed: p.updated, kind: 'page' as const }))
  for (const n of notes) {
    const insights = isInsightsNote(n)
    for (const u of unitsOf(n)) {
      const node = graph.find((g) => g.id === u.id)
      if (!node) continue
      if (insights) out.push({ id: u.id, noteId: n.id, section: u.heading, label: u.label, text: u.text, kind: 'insight' })
      else if (node.absorbed && isUnit(node, graph)) out.push({ id: u.id, noteId: n.id, section: u.heading, label: u.label, text: u.text, absorbed: node.absorbed, kind: 'unit' })
    }
  }
  return out
}

export function retrieve(question: string, history: AskRequest['history'], passages: Passage[], limit = MAX_SOURCES): Passage[] {
  const recent = history.slice(-4).map((t) => t.content).join(' ')
  const q = tokens(question + ' ' + recent)
  return passages
    .map((p) => ({ p, score: scoreUnit(q, p.text + ' ' + p.label) * (p.kind === 'page' ? 1.3 : 1) }))
    .filter((x) => x.score > 0 || substance(x.p.text) > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p)
}

const SYSTEM = `You answer questions from a person's own wiki: pages derived from their notes, the sections they absorbed, and insight cards they wrote. These are things they have already thought through, so treat them as their considered positions.

Rules:
- Answer only from the PASSAGES. If they do not cover the question, say so plainly and say what the closest thing they contain is. Never fill gaps with general knowledge presented as if it came from their notes.
- Quote or closely paraphrase their own wording. Do not rewrite their conclusions into something smoother.
- Cite by passage number in square brackets, e.g. [2], right after the claim it supports.
- Be brief: a few sentences, or a short list when they asked for several things. Talk to them directly.

Respond ONLY with JSON: { "reply": "markdown answer with [n] citations", "used": [1, 2] }`

export function buildAskMessages(req: AskRequest, passages: Passage[]): ChatMessage[] {
  const packet = [
    `Today: ${new Date().toISOString().slice(0, 10)}`,
    passages.length ? 'PASSAGES (wiki pages, absorbed sections, insight cards):' : 'PASSAGES: none match.',
    ...passages.map((p, i) => `[${i + 1}] ${p.label}${p.absorbed ? ` (${p.kind === 'page' ? 'updated' : 'absorbed'} ${p.absorbed})` : ''}\n${cut(p.text.trim(), RELATED_CAP * 2)}`)
  ].join('\n\n')
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: packet },
    { role: 'assistant', content: '{"reply": "Read them. What do you want to know?", "used": []}' },
    ...req.history.slice(-8).map((t) => ({ role: t.role, content: t.content }) as ChatMessage),
    { role: 'user', content: req.question }
  ]
}

export function parseAsk(raw: string, passages: Passage[]): { reply: string; sources: AskSource[] } {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  try {
    const data = JSON.parse(text)
    const reply = typeof data.reply === 'string' ? data.reply : text
    const cited = new Set<number>([...(Array.isArray(data.used) ? data.used.map(Number) : []), ...[...reply.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]))])
    const sources: AskSource[] = [...cited].filter((i) => passages[i - 1]).sort((a, b) => a - b).map((i) => {
      const p = passages[i - 1]
      return { nodeId: p.id, noteId: p.noteId, section: p.section, page: p.page, label: p.label }
    })
    return { reply, sources }
  } catch {
    return { reply: text, sources: [] }
  }
}

export async function ask(req: AskRequest, notes: StoredNote[], pages: WikiPage[], cfg: AiConfig): Promise<AskResult> {
  const passages = retrieve(req.question, req.history, wikiPassages(notes, pages))
  if (!passages.length) return { reply: 'The wiki is empty so far. Absorb a note and ask again.', sources: [], model: cfg.model }
  const raw = await chat(cfg, buildAskMessages(req, passages), { json: true, maxTokens: 900 })
  return { ...parseAsk(raw, passages), model: cfg.model }
}
