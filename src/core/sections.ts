/** Long-running notes are made of sections: an H1/H2/H3 heading and everything until the next heading. */
export interface Section {
  heading: string
  /** heading with any trailing date removed */
  title: string
  level: number
  /** ISO date parsed from the heading, e.g. "Standup 10/13" -> 2026-10-13 */
  date?: string
  /** line index range in the body, [start, end) */
  start: number
  end: number
  text: string
}

const DATE_RE = /\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*$/

export function parseHeadingDate(heading: string, now = new Date()): { title: string; date?: string } {
  const m = heading.match(DATE_RE)
  if (!m) return { title: heading.trim() }
  const month = Number(m[1]); const day = Number(m[2])
  let year = m[3] ? Number(m[3]) : now.getFullYear()
  if (year < 100) year += 2000
  if (month < 1 || month > 12 || day < 1 || day > 31) return { title: heading.trim() }
  // a heading dated in the future (e.g. 12/20 written in January) most likely means last year
  const d = new Date(year, month - 1, day)
  if (!m[3] && d.getTime() - now.getTime() > 7 * 86400000) d.setFullYear(year - 1)
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { title: heading.replace(DATE_RE, '').trim(), date: iso }
}

export function parseSections(body: string): Section[] {
  const lines = body.split('\n')
  const out: Section[] = []
  let cur: Section | null = null
  let inCode = false
  const close = (end: number) => {
    if (!cur) return
    cur.end = end
    cur.text = lines.slice(cur.start + 1, end).join('\n')
    out.push(cur)
  }
  lines.forEach((line, i) => {
    if (/^```/.test(line)) inCode = !inCode
    if (inCode) return
    const h = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/)
    if (!h) return
    close(i)
    const { title, date } = parseHeadingDate(h[2])
    cur = { heading: h[2].trim(), title, level: h[1].length, date, start: i, end: lines.length, text: '' }
  })
  close(lines.length)
  return out
}

/** Markdown of one unit: the section with its H3 children, or the preamble. Null if missing. */
export function unitMarkdown(body: string, heading: string | undefined): string | null {
  const lines = body.split('\n')
  const sections = parseSections(body)
  if (!heading) return lines.slice(0, sections[0]?.start ?? lines.length).join('\n')
  const i = sections.findIndex((s) => s.heading === heading)
  if (i < 0) return null
  const sec = sections[i]
  const next = sections.slice(i + 1).find((s) => s.level <= sec.level)
  return lines.slice(sec.start + 1, next ? next.start : lines.length).join('\n')
}
