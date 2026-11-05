/**
 * Retrieval shared by the agents: split notes into context units (preamble + H1/H2 sections with their
 * H3s folded in) and rank them against a focus text by word overlap. No model calls here.
 */
import type { StoredNote } from '../store'
import { parseSections } from '../sections'
import { buildGraph, slug } from '../graph'

export const RELATED_CAP = 900

const STOP = new Set('the and for that with this from have what when then than they them were will your about into which there their would could should been being over just also more some like make made very much many most such only other these those how why who did does doing done out off not but can our you are was its it\'s'.split(' '))
export const tokens = (s: string) => {
  const out = new Map<string, number>()
  for (const w of s.toLowerCase().match(/[a-z][a-z0-9'-]{3,}/g) ?? []) if (!STOP.has(w)) out.set(w, (out.get(w) ?? 0) + 1)
  return out
}
/** words that are the user's own writing, not template scaffolding (labels, empty todos, filing lines, rules) */
export const substance = (text: string) => text.split('\n')
  .filter((l) => !/^\s*(#{1,6}\s|Links:|Reviewed:|[-*]\s*\[[ x]\]\s*$|-{3,}\s*$|<\/?details|<summary)/i.test(l))
  .join(' ').split(/\s+/).filter(Boolean).length
export const MIN_WORDS = 12
export const cut = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n).replace(/\n[^\n]*$/, '') + '\n…')

export interface Candidate { id: string; noteId: string; label: string; text: string; score: number }

export interface Unit { id: string; noteId: string; heading?: string; label: string; text: string }

/** Context units: the preamble, then each H1/H2 section with its H3 subsections folded in. */
export function unitsOf(n: { id: string; title: string; body: string }): Unit[] {
  const sections = parseSections(n.body)
  const lines = n.body.split('\n')
  const out: Unit[] = []
  const preamble = lines.slice(0, sections[0]?.start ?? lines.length).join('\n').trim()
  if (preamble) out.push({ id: n.id, noteId: n.id, label: n.title || 'Untitled', text: preamble })
  for (const s of sections) {
    const last = out[out.length - 1]
    if (s.level >= 3 && last?.heading) {
      last.text += `\n\n### ${s.heading}\n${s.text}`
      continue
    }
    out.push({ id: `${n.id}#${slug(s.heading)}`, noteId: n.id, heading: s.heading, label: `${n.title || 'Untitled'} › ${s.heading}`, text: s.text })
  }
  return out
}

export function scoreUnit(focusTokens: Map<string, number>, text: string): number {
  const t = tokens(text)
  let overlap = 0
  for (const [w, c] of t) if (focusTokens.has(w)) overlap += Math.min(c, focusTokens.get(w)!)
  return overlap / Math.sqrt(t.size + 1)
}

/** Pick the sections from other parts of the corpus most related to the focus text. */
export function relatedSections(focusText: string, focusNoteId: string, focusHeading: string | undefined, notes: StoredNote[], limit = 6): Candidate[] {
  const graph = buildGraph(notes)
  const focusId = focusHeading ? `${focusNoteId}#${slug(focusHeading)}` : focusNoteId
  const focusNode = graph.find((g) => g.id === focusId)
  const linked = new Set<string>([...(focusNode?.links ?? []), ...(focusNode?.backlinks ?? [])])
  const focusTokens = tokens(focusText)
  const out: Candidate[] = []
  for (const n of notes) {
    for (const p of unitsOf(n)) {
      if (p.id === focusId || substance(p.text) < MIN_WORDS) continue
      if (n.id === focusNoteId && !focusHeading) continue // whole-note focus already includes these
      let score = scoreUnit(focusTokens, p.text)
      if (linked.has(p.id)) score += 100
      if (score > 0) out.push({ id: p.id, noteId: n.id, label: p.label, text: cut(p.text.trim(), RELATED_CAP), score })
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}
