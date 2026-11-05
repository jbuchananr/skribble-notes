/**
 * The review pile: sections you have written but not yet synthesized. A note is reviewed section by
 * section; a note with no headings is one unit. Only depends on the graph, so the renderer can use it.
 */
import type { GraphNode } from '../shared/types'

const MIN_CHARS = 20

export function isReviewUnit(node: GraphNode, graph: GraphNode[]): boolean {
  if (node.level === 0) {
    // the preamble counts only for notes that have no sections at all
    return !graph.some((g) => g.noteId === node.noteId && g.level > 0) && node.preview.length >= MIN_CHARS
  }
  return node.level <= 2 && node.preview.length >= MIN_CHARS
}

/** when the unit happened: the date in its heading, else the note's last edit */
export function unitTime(node: GraphNode): number {
  if (node.date) { const t = Date.parse(node.date + 'T12:00:00'); if (!Number.isNaN(t)) return t }
  return node.updatedAt
}

export function reviewQueue(graph: GraphNode[]): GraphNode[] {
  return graph.filter((g) => !g.reviewed && isReviewUnit(g, graph)).sort((a, b) => unitTime(b) - unitTime(a))
}

export function reviewedUnits(graph: GraphNode[]): GraphNode[] {
  return graph.filter((g) => g.reviewed && isReviewUnit(g, graph)).sort((a, b) => (b.reviewed! > a.reviewed! ? 1 : -1))
}
