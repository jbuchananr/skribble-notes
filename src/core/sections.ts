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
  /** ISO date from a "Reviewed: 2026-11-05" line: the section has been synthesized and filed */
  reviewed?: string
  reviewedLine?: number
  /** line index of a "Links: [[…]]" line written by filing */
  linksLine?: number
}

const DATE_RE = /\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*$/
export const REVIEWED_RE = /^\s*(?:\*\*)?Reviewed:?(?:\*\*)?\s*(\d{4}-\d{2}-\d{2})/i
export const LINKS_RE = /^\s*(?:\*\*)?Links:?(?:\*\*)?\s*/i

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
    const slice = lines.slice(cur.start + 1, end)
    cur.text = slice.join('\n')
    slice.forEach((l, i) => {
      const r = l.match(REVIEWED_RE); if (r && cur!.reviewed === undefined) { cur!.reviewed = r[1]; cur!.reviewedLine = cur!.start + 1 + i }
      if (LINKS_RE.test(l) && cur!.linksLine === undefined) cur!.linksLine = cur!.start + 1 + i
    })
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

/** A section's reviewed date, counting a marker written at the end of its last H3 child (filing writes it there). */
export function unitReviewed(sections: Section[], i: number): string | undefined {
  const sec = sections[i]
  if (sec.reviewed) return sec.reviewed
  for (let j = i + 1; j < sections.length && sections[j].level > sec.level; j++) if (sections[j].reviewed) return sections[j].reviewed
  return undefined
}
