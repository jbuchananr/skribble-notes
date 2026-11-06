/**
 * Inbox and brain. Every H1/H2 section you write (or a note without headings) is a unit; it sits in
 * the inbox until absorbed. Depends only on the graph, so the renderer can use it.
 */
import type { GraphNode } from '../shared/types'

const hasText = (s: string) => s.replace(/\u00a0/g, ' ').trim().length > 0

/** Any section with text in it is a unit, however short. A note with no headings is one unit once it has a title or text. */
export function isUnit(node: GraphNode, graph: GraphNode[]): boolean {
  if (node.insight || node.system) return false
  if (node.level === 0) {
    // the preamble counts only for notes that have no sections at all
    return !graph.some((g) => g.noteId === node.noteId && g.level > 0) && (hasText(node.preview) || hasText(node.noteTitle))
  }
  return node.level <= 2 && hasText(node.preview)
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
