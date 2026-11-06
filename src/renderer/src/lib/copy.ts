import type { Note } from '../../../shared/types'
import { htmlToMd } from '../../../core/markdown'
import { unitMarkdown } from '../../../core/sections'

/** A note as markdown: its title as an H1, then the body. */
export function noteMarkdown(note: Note): string {
  const body = htmlToMd(note.content).trim()
  return note.title.trim() ? `# ${note.title.trim()}\n\n${body}` : body
}

/** One section of a note as markdown, heading included; the whole note when there is no section. */
export function sectionMarkdown(note: Note, section?: string): string {
  if (!section) return noteMarkdown(note)
  const md = htmlToMd(note.content)
  const line = md.split('\n').find((l) => /^#{1,3}\s/.test(l) && l.replace(/^#{1,3}\s+/, '').replace(/\s*#*\s*$/, '').trim() === section)
  const body = unitMarkdown(md, section)
  return body === null ? noteMarkdown(note) : `${line ?? `## ${section}`}\n${body}`.trim()
}
