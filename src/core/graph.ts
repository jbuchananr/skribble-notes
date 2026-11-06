import type { GraphNode } from '../shared/types'
import type { StoredNote } from './store'
import { extractTags, mdToText } from './markdown'
import { parseSections } from './sections'
import { getAbsorbed } from './absorb'

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export const INSIGHT_TITLES = new Set(['insights', 'learnings', 'insights & learnings', 'insights and learnings', 'key learnings'])
export const isInsightsNote = (n: { title: string }) => INSIGHT_TITLES.has(n.title.trim().toLowerCase())

/** Build the graph with one node per section (plus one for text before the first heading). */
export function buildGraph(notes: StoredNote[]): GraphNode[] {
  const nodes: GraphNode[] = []
  const byNoteTitle = new Map<string, string>()
  const bySectionKey = new Map<string, string>() // `${noteTitle lower}#${section slug}` -> node id
  const bodies = new Map<string, string>()
  const extraLinks = new Map<string, string[]>() // node id -> wikilink targets from its absorbed entry

  for (const n of notes) {
    const title = n.title.trim()
    const insights = isInsightsNote(n)
    const system = n.kind === 'actions' ? { system: true } : {}
    if (title) byNoteTitle.set(title.toLowerCase(), n.id)
    const sections = parseSections(n.body)
    const lines = n.body.split('\n')
    const preambleEnd = sections[0]?.start ?? lines.length
    const preamble = lines.slice(0, preambleEnd).join('\n')
    const pre = sections.length ? undefined : getAbsorbed(n.absorbed)
    nodes.push({ id: n.id, noteId: n.id, noteTitle: title, level: 0, tags: [...new Set([...extractTags(preamble), ...(pre?.tags ?? [])])], links: [], backlinks: [], absorbed: pre?.date, preview: mdToText(preamble).slice(0, 140), updatedAt: n.updatedAt, ...system })
    bodies.set(n.id, preamble)
    if (pre) extraLinks.set(n.id, pre.links)
    for (const sec of sections) {
      const id = `${n.id}#${slug(sec.heading)}`
      const a = sec.level <= 2 ? getAbsorbed(n.absorbed, sec.heading) : undefined
      const node: GraphNode = {
        id, noteId: n.id, noteTitle: title, section: sec.heading, level: sec.level, date: sec.date,
        tags: [...new Set([...extractTags(sec.text), ...(a?.tags ?? [])])], links: [], backlinks: [],
        absorbed: a?.date, preview: mdToText(sec.text).slice(0, 140), updatedAt: n.updatedAt,
        ...(insights && sec.level === 3 ? { insight: true } : {}),
        ...system
      }
      nodes.push(node)
      bodies.set(id, sec.text)
      if (a) extraLinks.set(id, a.links)
      if (title) {
        bySectionKey.set(`${title.toLowerCase()}#${slug(sec.heading)}`, id)
        bySectionKey.set(`${title.toLowerCase()}#${slug(sec.title)}`, id)
      }
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const resolve = (target: string): string | undefined => {
    const m = target.match(/^([^#]+)(?:#(.+))?$/)
    if (!m) return undefined
    const noteTitle = m[1].trim().toLowerCase()
    const section = m[2]?.trim()
    const targetNote = byNoteTitle.get(noteTitle)
    if (!targetNote) return undefined
    return section ? bySectionKey.get(`${noteTitle}#${slug(section)}`) ?? targetNote : targetNote
  }
  for (const node of nodes) {
    const body = bodies.get(node.id) ?? ''
    const targets = [...[...body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1]), ...(extraLinks.get(node.id) ?? [])]
    for (const t of targets) {
      const target = resolve(t)
      if (!target || target === node.id) continue
      if (!node.links.includes(target)) node.links.push(target)
      const tn = byId.get(target)!
      if (!tn.backlinks.includes(node.id)) tn.backlinks.push(node.id)
    }
  }
  return nodes
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
