/**
 * Filing: what "mark reviewed" writes into a section. Pure markdown in, markdown out, so the editor,
 * the main process and the MCP server all do exactly the same thing.
 *
 * A filed section ends with:
 *   Links: [[Note#Section]] · [[Other note]] · #tag
 *
 *   Reviewed: 2026-11-05
 * (separate paragraphs, so the editor's soft line breaks never merge them)
 * The links line is the only thing the agent influences, and only after the user picked which to keep.
 */
import type { Filing, GraphNode } from '../shared/types'
import { parseSections, LINKS_RE, REVIEWED_RE } from './sections'

export const today = () => new Date().toISOString().slice(0, 10)

/** The wikilink target for a graph node: "Title" for a note, "Title#Heading" for a section. */
export function wikilinkTarget(node: GraphNode): string | null {
  const title = node.noteTitle.trim()
  if (!title) return null
  return node.section ? `${title}#${node.section}` : title
}

export function formatLinksLine(links: string[], tags: string[]): string | null {
  const parts = [...links.map((l) => `[[${l}]]`), ...tags.map((t) => `#${t.replace(/^#/, '')}`)]
  return parts.length ? `Links: ${parts.join(' · ')}` : null
}

/** [start, end) line range of the review unit: a section plus its H3 children, or the preamble. */
export function unitRange(body: string, heading: string | undefined): { start: number; end: number } | null {
  const lines = body.split('\n')
  const sections = parseSections(body)
  if (!heading) return { start: 0, end: sections[0]?.start ?? lines.length }
  const i = sections.findIndex((s) => s.heading === heading)
  if (i < 0) return null
  const sec = sections[i]
  const next = sections.slice(i + 1).find((s) => s.level <= sec.level)
  return { start: sec.start + 1, end: next ? next.start : lines.length }
}

/** Write (or rewrite) the Links and Reviewed lines at the end of the section. Returns null if the section is missing. */
export function applyFiling(body: string, heading: string | undefined, filing: Filing): string | null {
  const range = unitRange(body, heading)
  if (!range) return null
  const lines = body.split('\n')
  const inner = lines.slice(range.start, range.end).filter((l) => !LINKS_RE.test(l) && !REVIEWED_RE.test(l))
  while (inner.length && !inner[inner.length - 1].trim()) inner.pop()
  const linksLine = formatLinksLine(filing.links, filing.tags)
  const block = [...(inner.length ? [''] : []), ...(linksLine ? [linksLine, ''] : []), `Reviewed: ${filing.reviewed}`]
  const isPreamble = !heading
  const tail = range.end < lines.length || isPreamble ? [''] : []
  const out = [...lines.slice(0, range.start), ...inner, ...block, ...tail, ...lines.slice(range.end)]
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

/** Existing filed links in a section, so re-filing starts from what is already there. */
export function existingLinks(body: string, heading: string | undefined): string[] {
  const range = unitRange(body, heading)
  if (!range) return []
  const line = body.split('\n').slice(range.start, range.end).find((l) => LINKS_RE.test(l))
  if (!line) return []
  return [...line.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim())
}
