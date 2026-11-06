/**
 * Two-way sync of the notes folder with one Postgres table, so the same notes and wiki show up on every
 * machine. Files stay the source of truth on disk; the table is the meeting point.
 *
 * - every text file under NOTES_DIR is a row keyed by its relative path (notes, wiki, templates, ledgers)
 * - rows carry a server-assigned `rev`; each device pulls rows newer than the last rev it saw
 * - a push is an optimistic upsert: it only lands if the row still holds the version this device last
 *   synced, otherwise the next pull sees both sides and resolves them
 * - both sides changed: newest mtime wins and the loser is kept under .conflicts/ (never silently lost);
 *   the first sync on a new machine lets the cloud win instead
 * - deletes are tombstones; a file edited locally after being deleted elsewhere comes back
 */
import { promises as fs } from 'fs'
import { join, dirname, relative, sep } from 'path'
import { createHash } from 'crypto'
import { neon } from '@neondatabase/serverless'
import { NOTES_DIR, CONFIG_DIR } from '../paths'
import { DEVICE_ID, readCloudConfig } from './config'

export interface SyncResult { pushed: number; pulled: number; deleted: number; conflicts: number; changed: boolean }

const TEXT = /\.(md|markdown|txt|json|ya?ml|csv)$/i
const SKIP_DIRS = new Set(['.conflicts', '.git', 'node_modules', '.sync'])
const MAX_BYTES = 2 * 1024 * 1024
const BATCH = 40

const STATE_FILE = join(CONFIG_DIR, 'sync', `${createHash('sha256').update(NOTES_DIR).digest('hex').slice(0, 12)}.json`)
export const CONFLICTS_DIR = join(NOTES_DIR, '.conflicts')

interface Entry { sha: string; mtime: number }
interface State { cursor: number; files: Record<string, Entry> }
interface LocalFile extends Entry { content: string }
interface Row { path: string; content: string | null; sha: string; mtime: number | string; deleted: boolean; rev: number | string; device: string }

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const toPosix = (p: string) => p.split(sep).join('/')

export function syncable(rel: string) {
  const parts = rel.split('/')
  if (parts.some((p) => SKIP_DIRS.has(p) || p === '.DS_Store' || p.endsWith('.tmp'))) return false
  return TEXT.test(rel)
}

/** Every syncable file under the notes folder, hashed. */
export async function scanLocal(root = NOTES_DIR): Promise<Map<string, LocalFile>> {
  const out = new Map<string, LocalFile>()
  const walk = async (dir: string) => {
    let entries: import('fs').Dirent[]
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const abs = join(dir, e.name)
      const rel = toPosix(relative(root, abs))
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(abs); continue }
      if (!e.isFile() || !syncable(rel)) continue
      const st = await fs.stat(abs)
      if (st.size > MAX_BYTES) { console.warn('sync: skipping large file', rel); continue }
      const content = await fs.readFile(abs, 'utf8')
      out.set(rel, { content, sha: sha256(content), mtime: Math.round(st.mtimeMs) })
    }
  }
  await walk(root)
  return out
}

async function readState(): Promise<{ state: State; fresh: boolean }> {
  try {
    const raw = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'))
    return { state: { cursor: Number(raw.cursor) || 0, files: raw.files ?? {} }, fresh: false }
  } catch {
    return { state: { cursor: 0, files: {} }, fresh: true }
  }
}

async function writeState(state: State) {
  await fs.mkdir(dirname(STATE_FILE), { recursive: true })
  await fs.writeFile(STATE_FILE, JSON.stringify(state), 'utf8')
}

async function writeLocal(rel: string, content: string, mtime: number) {
  const abs = join(NOTES_DIR, rel)
  await fs.mkdir(dirname(abs), { recursive: true })
  const tmp = abs + '.tmp'
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, abs)
  const t = new Date(mtime)
  await fs.utimes(abs, t, t)
}

/** Files both machines append to independently can be unioned instead of picking a winner. */
function merge(rel: string, local: string, remote: string): string | null {
  if (rel === 'wiki/.ingested.json') {
    try { return JSON.stringify({ ...JSON.parse(remote), ...JSON.parse(local) }, null, 2) } catch { return null }
  }
  if (rel === 'wiki/log.md') {
    const seen = new Set(remote.split('\n'))
    const extra = local.split('\n').filter((l) => l.trim() && !seen.has(l))
    return extra.length ? remote.replace(/\s*$/, '\n\n') + extra.join('\n') + '\n' : remote
  }
  return null
}

async function keepConflictCopy(rel: string, content: string, from: string) {
  await fs.mkdir(CONFLICTS_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `${rel.replace(/\//g, '__').replace(/\.(\w+)$/, '')}.${from}.${stamp}.${rel.match(/\.(\w+)$/)?.[1] ?? 'txt'}`
  await fs.writeFile(join(CONFLICTS_DIR, name), content, 'utf8')
}

type Sql = ReturnType<typeof neon>
const ready = new WeakSet<Sql>()
async function ensureSchema(sql: Sql) {
  if (ready.has(sql)) return
  await sql`create table if not exists files (
    path text primary key,
    content text,
    sha text not null,
    mtime bigint not null,
    deleted boolean not null default false,
    device text not null,
    rev bigint not null,
    updated_at timestamptz not null default now()
  )`
  await sql`create sequence if not exists files_rev`
  await sql`create index if not exists files_rev_idx on files (rev)`
  ready.add(sql)
}

const clients = new Map<string, Sql>()
function client(url: string): Sql {
  let c = clients.get(url)
  if (!c) { c = neon(url); clients.set(url, c) }
  return c
}

/** Upsert that only lands if the row still holds `prevSha` (or is a tombstone / missing). Returns the new rev, or null if someone else got there first. */
async function push(sql: Sql, rel: string, f: { content: string | null; sha: string; mtime: number; deleted: boolean }, prevSha: string | null): Promise<number | null> {
  const rows = await sql`
    insert into files (path, content, sha, mtime, deleted, device, rev, updated_at)
    values (${rel}, ${f.content}, ${f.sha}, ${f.mtime}, ${f.deleted}, ${DEVICE_ID}, nextval('files_rev'), now())
    on conflict (path) do update set
      content = excluded.content, sha = excluded.sha, mtime = excluded.mtime, deleted = excluded.deleted,
      device = excluded.device, rev = excluded.rev, updated_at = excluded.updated_at
    where files.deleted or files.sha is not distinct from ${prevSha} or files.device = ${DEVICE_ID}
    returning rev` as { rev: number | string }[]
  return rows.length ? Number(rows[0].rev) : null
}

let running: Promise<SyncResult> | null = null

/** One full cycle: pull what other devices wrote, then push what changed here. Safe to call often; overlapping calls share one run. */
export function syncOnce(): Promise<SyncResult> {
  if (!running) running = run().finally(() => { running = null })
  return running
}

async function run(): Promise<SyncResult> {
  const cfg = await readCloudConfig()
  if (!cfg) throw new Error('Cloud sync is not configured')
  const sql = client(cfg.databaseUrl)
  await ensureSchema(sql)
  const { state, fresh } = await readState()
  const local = await scanLocal()
  const result: SyncResult = { pushed: 0, pulled: 0, deleted: 0, conflicts: 0, changed: false }

  // ---- pull: rows other devices wrote since our cursor ----
  const rows = await sql`select path, content, sha, mtime, deleted, rev, device from files where rev > ${state.cursor} and device <> ${DEVICE_ID} order by rev` as Row[]
  for (const r of rows) {
    const rel = r.path
    if (!syncable(rel) || rel.includes('..')) continue
    const s = state.files[rel]
    const l = local.get(rel)
    const localChanged = l ? l.sha !== s?.sha : !!s
    const mtime = Number(r.mtime)
    if (r.deleted) {
      if (l && !localChanged) { await fs.rm(join(NOTES_DIR, rel), { force: true }); local.delete(rel); result.deleted++; result.changed = true }
      if (!l || !localChanged) delete state.files[rel]
      // edited here after being deleted elsewhere: keep it, the push below brings it back
    } else if (r.content === null) {
      continue
    } else if (l && l.sha === r.sha) {
      state.files[rel] = { sha: r.sha, mtime: l.mtime }
    } else if (!localChanged) {
      await writeLocal(rel, r.content, mtime)
      local.set(rel, { content: r.content, sha: r.sha, mtime })
      state.files[rel] = { sha: r.sha, mtime }
      result.pulled++; result.changed = true
    } else {
      // both sides changed since we last agreed
      const merged = merge(rel, l!.content, r.content)
      if (merged !== null) {
        // union: write it locally; it differs from the row, so the push below sends it up
        await writeLocal(rel, merged, Date.now())
        local.set(rel, { content: merged, sha: sha256(merged), mtime: Date.now() })
        state.files[rel] = { sha: r.sha, mtime }
        state.cursor = Math.max(state.cursor, Number(r.rev))
        result.pulled++; result.changed = true
        continue
      }
      result.conflicts++
      const remoteWins = fresh || mtime >= l!.mtime
      if (remoteWins) {
        await keepConflictCopy(rel, l!.content, DEVICE_ID)
        await writeLocal(rel, r.content, mtime)
        local.set(rel, { content: r.content, sha: r.sha, mtime })
        result.pulled++; result.changed = true
      } else {
        await keepConflictCopy(rel, r.content, r.device)
      }
      // either way the row is now our baseline: a local winner differs from it and gets pushed below
      state.files[rel] = { sha: r.sha, mtime }
    }
    state.cursor = Math.max(state.cursor, Number(r.rev))
  }

  // ---- push: local files that differ from the last synced version, and tombstones for files gone locally ----
  const ups: { rel: string; f: { content: string | null; sha: string; mtime: number; deleted: boolean }; prev: string | null }[] = []
  for (const [rel, l] of local) {
    const s = state.files[rel]
    if (s && s.sha === l.sha) continue
    ups.push({ rel, f: { content: l.content, sha: l.sha, mtime: l.mtime, deleted: false }, prev: s?.sha ?? null })
  }
  for (const rel of Object.keys(state.files)) {
    if (local.has(rel)) continue
    ups.push({ rel, f: { content: null, sha: sha256(''), mtime: Date.now(), deleted: true }, prev: state.files[rel].sha })
  }
  for (let i = 0; i < ups.length; i += BATCH) {
    const chunk = ups.slice(i, i + BATCH)
    const revs = await Promise.all(chunk.map((u) => push(sql, u.rel, u.f, u.prev)))
    chunk.forEach((u, j) => {
      if (revs[j] === null) return // someone else changed it meanwhile; the next pull resolves it
      if (u.f.deleted) { delete state.files[u.rel]; result.deleted++ }
      else { state.files[u.rel] = { sha: u.f.sha, mtime: u.f.mtime }; result.pushed++ }
    })
  }

  await writeState(state)
  return result
}

/** Forget this device's sync position (files are untouched). The next sync starts over as a fresh device. */
export async function resetSyncState() {
  await fs.rm(STATE_FILE, { force: true })
}
