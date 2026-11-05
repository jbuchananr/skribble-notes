/**
 * Chat over what you have already synthesized: reviewed sections and insight cards. Unreviewed notes
 * are deliberately out of scope, so answers only ever come from thinking you have finished.
 */
import type { AskRequest, AskResult, AskSource } from '../../shared/types'
import type { StoredNote } from '../store'
import { buildGraph, label } from '../graph'
import { isReviewUnit } from '../review'
import { unitsOf, tokens, scoreUnit, cut, RELATED_CAP, substance } from './context'
import { chat, type ChatMessage } from './openrouter'
import type { AiConfig } from './config'

const MAX_SOURCES = 8
const INSIGHT_TITLES = new Set(['insights', 'learnings', 'insights & learnings', 'insights and learnings', 'key learnings'])

export interface Passage { id: string; noteId: string; label: string; text: string; reviewed?: string }

/** Everything that counts as published: reviewed units plus every card in the Insights note. */
export function publishedPassages(notes: StoredNote[]): Passage[] {
  const graph = buildGraph(notes)
  const out: Passage[] = []
  for (const n of notes) {
    const isInsights = INSIGHT_TITLES.has(n.title.trim().toLowerCase())
    for (const u of unitsOf(n)) {
      const node = graph.find((g) => g.id === u.id)
      if (!node) continue
      if (isInsights || (node.reviewed && isReviewUnit(node, graph))) out.push({ id: u.id, noteId: n.id, label: u.label, text: u.text, reviewed: node.reviewed })
    }
  }
  return out
}

export function retrieve(question: string, history: AskRequest['history'], passages: Passage[], limit = MAX_SOURCES): Passage[] {
  const recent = history.slice(-4).map((t) => t.content).join(' ')
  const q = tokens(question + ' ' + recent)
  return passages
    .map((p) => ({ p, score: scoreUnit(q, p.text + ' ' + p.label) }))
    .filter((x) => x.score > 0 || substance(x.p.text) > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p)
}

const SYSTEM = `You answer questions from a person's own reviewed notes and insight cards. These are things they have already thought through and filed, so treat them as their considered positions.

Rules:
- Answer only from the PASSAGES. If they do not cover the question, say so plainly and say what the closest thing they contain is. Never fill gaps with general knowledge presented as if it came from their notes.
- Quote or closely paraphrase their own wording. Do not rewrite their conclusions into something smoother.
- Cite by passage number in square brackets, e.g. [2], right after the claim it supports.
- Be brief: a few sentences, or a short list when they asked for several things. Talk to them directly.

Respond ONLY with JSON: { "reply": "markdown answer with [n] citations", "used": [1, 2] }`

export function buildAskMessages(req: AskRequest, passages: Passage[]): ChatMessage[] {
  const packet = [
    `Today: ${new Date().toISOString().slice(0, 10)}`,
    passages.length ? 'PASSAGES (reviewed notes and insight cards):' : 'PASSAGES: none match.',
    ...passages.map((p, i) => `[${i + 1}] ${p.label}${p.reviewed ? ` (reviewed ${p.reviewed})` : ''}\n${cut(p.text.trim(), RELATED_CAP * 2)}`)
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
    const sources: AskSource[] = [...cited].filter((i) => passages[i - 1]).sort((a, b) => a - b).map((i) => ({ nodeId: passages[i - 1].id, noteId: passages[i - 1].noteId, label: passages[i - 1].label }))
    return { reply, sources }
  } catch {
    return { reply: text, sources: [] }
  }
}

export async function ask(req: AskRequest, notes: StoredNote[], cfg: AiConfig): Promise<AskResult> {
  const passages = retrieve(req.question, req.history, publishedPassages(notes))
  if (!passages.length) return { reply: 'Nothing is reviewed yet. Mark sections reviewed and they become searchable here.', sources: [], model: cfg.model }
  const raw = await chat(cfg, buildAskMessages(req, passages), { json: true, maxTokens: 900 })
  return { ...parseAsk(raw, passages), model: cfg.model }
}

export { label }
