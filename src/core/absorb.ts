/**
 * Absorbing: a section (or a headingless note) moves from the inbox into your brain. The record lives
 * in the note's frontmatter, keyed by section heading, so the body you wrote is never modified.
 */
import type { Absorbed, GraphNode } from '../shared/types'
import { parseSections } from './sections'

export const today = () => new Date().toISOString().slice(0, 10)

const key = (section?: string) => (section ?? '').trim()

export function getAbsorbed(list: Absorbed[], section?: string): Absorbed | undefined {
  return list.find((a) => key(a.section) === key(section))
}

/** Replace or add the entry for a unit. */
export function setAbsorbed(list: Absorbed[], entry: Absorbed): Absorbed[] {
  const links = [...new Set(entry.links.map((l) => l.trim()).filter(Boolean))]
  const tags = [...new Set(entry.tags.map(normalizeTag).filter(Boolean))]
  const clean: Absorbed = { ...(entry.section ? { section: entry.section } : {}), date: entry.date, links, tags }
  return [...list.filter((a) => key(a.section) !== key(entry.section)), clean]
}

export function unabsorb(list: Absorbed[], section?: string): Absorbed[] {
  return list.filter((a) => key(a.section) !== key(section))
}

export const normalizeTag = (t: string) => t.trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9/_-]+/g, '-').replace(/^-+|-+$/g, '')

/** The wikilink target for a graph node: "Title" for a note, "Title#Heading" for a section. */
export function wikilinkTarget(node: GraphNode): string | null {
  const title = node.noteTitle.trim()
  if (!title) return null
  return node.section ? `${title}#${node.section}` : title
}

// ---------- migration from the first version, which wrote "Links:" and "Reviewed:" lines into the body ----------
const REVIEWED_RE = /^\s*(?:\*\*)?Reviewed:?(?:\*\*)?\s*(\d{4}-\d{2}-\d{2})\s*$/i
const LINKS_RE = /^\s*(?:\*\*)?Links:?(?:\*\*)?\s*(.*)$/i

/** Pull marker lines out of the body into absorbed entries. Returns null when there is nothing to migrate. */
export function migrateMarkerLines(body: string, existing: Absorbed[]): { body: string; absorbed: Absorbed[] } | null {
  if (!REVIEWED_RE.test(body.split('\n').find((l) => /Reviewed:/i.test(l)) ?? '')) return null
  const lines = body.split('\n')
  const sections = parseSections(body)
  const drop = new Set<number>()
  let absorbed = existing
  // unit = H1/H2 section with its H3 children, or the preamble when there are no sections
  const units: { section?: string; start: number; end: number }[] = []
  if (!sections.length) units.push({ start: 0, end: lines.length })
  sections.forEach((s, i) => {
    if (s.level > 2) return
    const next = sections.slice(i + 1).find((x) => x.level <= s.level)
    units.push({ section: s.heading, start: s.start + 1, end: next ? next.start : lines.length })
  })
  if (sections.length && sections[0].start > 0) units.push({ start: 0, end: sections[0].start })
  for (const u of units) {
    let date: string | undefined
    let links: string[] = []
    let tags: string[] = []
    for (let i = u.start; i < u.end; i++) {
      const r = lines[i].match(REVIEWED_RE)
      if (r) { date = r[1]; drop.add(i); continue }
      const l = lines[i].match(LINKS_RE)
      if (l) {
        links = [...l[1].matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim())
        tags = [...l[1].matchAll(/(?:^|\s)#([a-zA-Z][\w/-]*)/g)].map((m) => m[1].toLowerCase())
        drop.add(i)
      }
    }
    if (date) absorbed = setAbsorbed(absorbed, { section: u.section, date, links, tags })
  }
  if (!drop.size) return null
  const kept = lines.filter((_, i) => !drop.has(i))
  return { body: kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n', absorbed }
}
