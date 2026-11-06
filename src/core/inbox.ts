/**
 * Inbox and brain. Each note is one unit, headings or not; it sits in the inbox until absorbed.
 * Depends only on the graph, so the renderer can use it.
 */
import type { GraphNode } from '../shared/types'
import { isInsightsNote } from './insight-titles'

const hasText = (s: string) => s.replace(/\u00a0/g, ' ').trim().length > 0

/** A note is the unit, however many headings it has, once it has a title or text. The Insights note is not one. */
export function isUnit(node: GraphNode, _graph?: GraphNode[]): boolean {
  if (node.insight || node.system || node.level !== 0 || isInsightsNote({ title: node.noteTitle })) return false
  return hasText(node.preview) || hasText(node.noteTitle)
}

/** when the unit happened: the date in its heading, else the note's last edit */
export function unitTime(node: GraphNode): number {
  if (node.date) { const t = Date.parse(node.date + 'T12:00:00'); if (!Number.isNaN(t)) return t }
  return node.updatedAt
}

export function inbox(graph: GraphNode[]): GraphNode[] {
  return graph.filter((g) => !g.absorbed && isUnit(g, graph)).sort((a, b) => unitTime(b) - unitTime(a))
}

/** Absorbed units and insight cards, most recently absorbed first. */
export function brain(graph: GraphNode[]): GraphNode[] {
  const when = (g: GraphNode) => g.insight ? g.updatedAt : Date.parse((g.absorbed ?? '1970-01-01') + 'T12:00:00')
  return graph.filter((g) => g.insight || (g.absorbed && isUnit(g, graph))).sort((a, b) => when(b) - when(a))
}

export const label = (n: GraphNode) => (n.section ? `${n.noteTitle || 'Untitled'} › ${n.section}` : n.noteTitle || 'Untitled')
