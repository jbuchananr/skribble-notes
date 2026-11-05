import type { GraphNode } from '../shared/types'
import type { StoredNote } from './store'
import { extractTags, mdToText } from './markdown'
import { parseSections, unitReviewed, REVIEWED_RE } from './sections'

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** Build the graph with one node per section (plus one for text before the first heading). */
export function buildGraph(notes: StoredNote[]): GraphNode[] {
  const nodes: GraphNode[] = []
  const byNoteTitle = new Map<string, string>()
  const bySectionKey = new Map<string, string>() // `${noteTitle lower}#${section slug}` -> node id
  const bodies = new Map<string, string>()

  for (const n of notes) {
    const title = n.title.trim()
    if (title) byNoteTitle.set(title.toLowerCase(), n.id)
    const sections = parseSections(n.body)
    const lines = n.body.split('\n')
    const preambleEnd = sections[0]?.start ?? lines.length
    const preamble = lines.slice(0, preambleEnd).join('\n')
    nodes.push({ id: n.id, noteId: n.id, noteTitle: title, level: 0, tags: extractTags(preamble), links: [], backlinks: [], reviewed: preambleReviewed(preamble), preview: mdToText(preamble).slice(0, 140), updatedAt: n.updatedAt })
    bodies.set(n.id, preamble)
    sections.forEach((sec, si) => {
      const id = `${n.id}#${slug(sec.heading)}`
      const node: GraphNode = {
        id, noteId: n.id, noteTitle: title, section: sec.heading, level: sec.level, date: sec.date,
        tags: extractTags(sec.text), links: [], backlinks: [],
        reviewed: unitReviewed(sections, si), preview: mdToText(sec.text).slice(0, 140), updatedAt: n.updatedAt
      }
      nodes.push(node)
      bodies.set(id, sec.text)
      if (title) {
        bySectionKey.set(`${title.toLowerCase()}#${slug(sec.heading)}`, id)
        bySectionKey.set(`${title.toLowerCase()}#${slug(sec.title)}`, id)
      }
    })
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const node of nodes) {
    const body = bodies.get(node.id) ?? ''
    for (const m of body.matchAll(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|[^\]]*)?\]\]/g)) {
      const noteTitle = m[1].trim().toLowerCase()
      const section = m[2]?.trim()
      const targetNote = byNoteTitle.get(noteTitle)
      if (!targetNote) continue
      const target = section ? bySectionKey.get(`${noteTitle}#${slug(section)}`) ?? targetNote : targetNote
      if (target === node.id) continue
      if (!node.links.includes(target)) node.links.push(target)
      const t = byId.get(target)!
      if (!t.backlinks.includes(node.id)) t.backlinks.push(node.id)
    }
  }
  return nodes
}

function preambleReviewed(text: string): string | undefined {
  for (const l of text.split('\n')) { const m = l.match(REVIEWED_RE); if (m) return m[1] }
  return undefined
}

export function nodesForNote(graph: GraphNode[], noteId: string) {
  return graph.filter((g) => g.noteId === noteId)
}

export function related(graph: GraphNode[], id: string): { links: GraphNode[]; backlinks: GraphNode[] } {
  const me = graph.find((g) => g.id === id)
  if (!me) return { links: [], backlinks: [] }
  const byId = new Map(graph.map((g) => [g.id, g]))
  return {
    links: me.links.map((l) => byId.get(l)!).filter(Boolean),
    backlinks: me.backlinks.map((l) => byId.get(l)!).filter(Boolean)
  }
}

export function label(n: GraphNode) {
  return n.section ? `${n.noteTitle || 'Untitled'} › ${n.section}` : (n.noteTitle || 'Untitled')
}
