import { promises as fs } from 'fs'
import { join } from 'path'
import matter from 'gray-matter'
import type { Note } from '../shared/types'
import { NOTES_DIR } from './paths'
import { htmlToMd, mdToHtml, mdToText, extractTags } from './markdown'

/** A note as stored on disk: frontmatter + markdown body. */
export interface StoredNote {
  id: string
  title: string
  body: string // markdown
  pinned: boolean
  tags: string[]
  createdAt: number
  updatedAt: number
  path: string
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled'
}

function fileFor(id: string, title: string) {
  return join(NOTES_DIR, `${slugify(title)}-${id.slice(0, 8)}.md`)
}

export async function ensureNotesDir() {
  await fs.mkdir(NOTES_DIR, { recursive: true })
}

// Frontmatter keys from earlier versions (folder, sources) are read and dropped; the body is what matters.
function parse(raw: string, path: string): StoredNote | null {
  const { data, content } = matter(raw)
  if (!data.id) return null
  const body = content.replace(/^\n+/, '')
  return {
    id: String(data.id),
    title: String(data.title ?? ''),
    body,
    pinned: Boolean(data.pinned),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : extractTags(body),
    createdAt: parseWhen(data.created) ?? Date.now(),
    updatedAt: parseWhen(data.updated) ?? Date.now(),
    path
  }
}

// Cache parsed notes by path + mtime so listing a big folder is cheap, and keep an id -> path index
// so saves never rescan the directory.
const cache = new Map<string, { mtimeMs: number; note: StoredNote }>()
const pathById = new Map<string, string>()

export async function listStored(): Promise<StoredNote[]> {
  await ensureNotesDir()
  const files = (await fs.readdir(NOTES_DIR)).filter((f) => f.endsWith('.md'))
  const seen = new Set<string>()
  const out: StoredNote[] = []
  for (const f of files) {
    const path = join(NOTES_DIR, f)
    seen.add(path)
    try {
      const st = await fs.stat(path)
      const hit = cache.get(path)
      if (hit && hit.mtimeMs === st.mtimeMs) { out.push(hit.note); continue }
      const n = parse(await fs.readFile(path, 'utf8'), path)
      if (n) { cache.set(path, { mtimeMs: st.mtimeMs, note: n }); pathById.set(n.id, path); out.push(n) }
    } catch (e) {
      console.error('bad note', f, e)
    }
  }
  for (const p of [...cache.keys()]) if (!seen.has(p)) { pathById.delete(cache.get(p)!.note.id); cache.delete(p) }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function readStored(id: string): Promise<StoredNote | null> {
  const p = pathById.get(id)
  if (p) {
    try {
      const st = await fs.stat(p)
      const hit = cache.get(p)
      if (hit && hit.mtimeMs === st.mtimeMs) return hit.note
      const n = parse(await fs.readFile(p, 'utf8'), p)
      if (n) { cache.set(p, { mtimeMs: st.mtimeMs, note: n }); return n }
    } catch { /* fall through to a rescan */ }
  }
  return (await listStored()).find((n) => n.id === id) ?? null
}

/** frontmatter dates may be ISO strings, epoch numbers, or Date objects (YAML parses bare dates) */
function parseWhen(v: unknown): number | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.getTime()
  if (typeof v === 'number') return Number.isFinite(v) ? (v < 1e11 ? v * 1000 : v) : undefined
  if (typeof v === 'string' && v.trim()) { const t = Date.parse(v); return Number.isNaN(t) ? undefined : t }
  return undefined
}
const iso = (t: number) => new Date(Number.isFinite(t) ? t : Date.now()).toISOString()

export function serialize(n: Omit<StoredNote, 'path'>): string {
  const fm: Record<string, unknown> = {
    id: n.id,
    title: n.title,
    created: iso(n.createdAt),
    updated: iso(n.updatedAt)
  }
  if (n.pinned) fm.pinned = true
  if (n.tags.length) fm.tags = n.tags
  return matter.stringify('\n' + n.body, fm)
}

export async function writeStored(n: Omit<StoredNote, 'path'>): Promise<StoredNote> {
  await ensureNotesDir()
  const target = fileFor(n.id, n.title)
  const previous = pathById.get(n.id) ?? (await listStored()).find((x) => x.id === n.id)?.path
  const tmp = target + '.tmp'
  await fs.writeFile(tmp, serialize(n), 'utf8')
  await fs.rename(tmp, target)
  if (previous && previous !== target) { await fs.rm(previous, { force: true }); cache.delete(previous) }
  const st = await fs.stat(target)
  const stored: StoredNote = { ...n, path: target }
  cache.set(target, { mtimeMs: st.mtimeMs, note: stored })
  pathById.set(n.id, target)
  return stored
}

export async function deleteStored(noteId: string) {
  const p = pathById.get(noteId) ?? (await listStored()).find((x) => x.id === noteId)?.path
  if (p) { await fs.rm(p, { force: true }); cache.delete(p); pathById.delete(noteId) }
}

// ---------- conversion to the renderer's shape ----------
export function toNote(s: StoredNote): Note {
  const text = mdToText(s.body)
  return {
    id: s.id,
    title: s.title,
    content: mdToHtml(s.body),
    preview: text.slice(0, 140),
    text,
    pinned: s.pinned,
    tags: s.tags,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt
  }
}

export function fromNote(n: Note): Omit<StoredNote, 'path'> {
  const body = htmlToMd(n.content)
  return {
    id: n.id,
    title: n.title,
    body,
    pinned: n.pinned,
    tags: extractTags(body),
    createdAt: n.createdAt,
    updatedAt: n.updatedAt
  }
}
