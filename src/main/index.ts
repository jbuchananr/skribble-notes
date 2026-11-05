import { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme } from 'electron'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { Note, Template, AppleNoteSummary, AiStatus, SuggestRequest, AbsorbRequest, AskRequest, WikiStatus } from '../shared/types'
import { NOTES_DIR } from '../core/paths'
import * as store from '../core/store'
import { buildGraph } from '../core/graph'
import { htmlToMd } from '../core/markdown'
import * as templates from '../core/templates'
import { readAiConfig, writeAiConfig } from '../core/ai/config'
import { suggestConnections } from '../core/ai/suggest'
import { ask } from '../core/ai/ask'
import { addInsight } from '../core/insights'
import { setAbsorbed, today, getAbsorbed } from '../core/absorb'
import * as wiki from '../core/wiki'
import { ingest, sourceRef } from '../core/ai/wiki'
import { buildGraph as graphOf } from '../core/graph'
import { isUnit } from '../core/inbox'
import type { StoredNote } from '../core/store'

const run = promisify(execFile)

app.setName('Skribble')
const ICON = join(__dirname, '../../assets/icon-1024.png')

let win: BrowserWindow | null = null

function send(channel: string, ...args: unknown[]) {
  win?.webContents.send(channel, ...args)
}

// ---------- notes ----------
async function listNotes(): Promise<Note[]> {
  return (await store.listStored()).map(store.toNote)
}

async function absorb(req: AbsorbRequest): Promise<Note> {
  const n = await store.readStored(req.noteId)
  if (!n) throw new Error('Note not found')
  const absorbed = setAbsorbed(n.absorbed, { section: req.section, date: today(), links: req.links, tags: req.tags })
  const saved = await store.writeStored({ ...n, absorbed, updatedAt: Date.now() })
  if (req.insight?.trim()) await addInsight({ text: req.insight, noteTitle: n.title || 'Untitled', section: req.section })
  send('notes-changed')
  // fold it into the wiki in the background; absorbing itself never waits on the model
  queueIngest({ note: saved, section: req.section, insight: req.insight?.trim() || undefined })
  return store.toNote(saved)
}

// ---------- wiki: a queue of absorbed units to fold in, one model call at a time ----------
type Job = { note: StoredNote; section?: string; insight?: string }
const jobs: Job[] = []
let wikiBusy = false
let wikiError: string | undefined

function queueIngest(job: Job) {
  if (!jobs.some((j) => j.note.id === job.note.id && (j.section ?? '') === (job.section ?? ''))) jobs.push(job)
  void drainIngest()
}

async function drainIngest() {
  if (wikiBusy) return
  const cfg = await readAiConfig()
  if (!cfg) { jobs.length = 0; return }
  wikiBusy = true
  send('wiki-changed')
  try {
    while (jobs.length) {
      const job = jobs.shift()!
      const fresh = (await store.readStored(job.note.id)) ?? job.note
      const entry = getAbsorbed(fresh.absorbed, job.section)
      if (!entry) continue
      try {
        await ingest({ note: fresh, section: job.section, entry, insight: job.insight }, cfg)
        await wiki.markIngested(sourceRef(fresh, job.section))
        wikiError = undefined
      } catch (e) {
        wikiError = (e as Error).message
        console.error('wiki ingest failed', sourceRef(fresh, job.section), wikiError)
      }
      send('wiki-changed')
    }
  } finally {
    wikiBusy = false
    send('wiki-changed')
  }
}

/** Absorbed units the wiki has not folded in yet. */
async function pendingIngests(): Promise<Job[]> {
  const notes = await store.listStored()
  const graph = graphOf(notes)
  const done = await wiki.readIngested()
  const out: Job[] = []
  for (const n of notes) {
    for (const a of n.absorbed) {
      const node = graph.find((g) => g.noteId === n.id && (a.section ? g.section === a.section : g.level === 0))
      if (!node || !isUnit(node, graph)) continue
      const ref = sourceRef(n, a.section)
      if (!done[ref]) out.push({ note: n, section: a.section })
    }
  }
  return out
}

async function wikiStatus(): Promise<WikiStatus> {
  return { pending: (await pendingIngests()).length + jobs.length, busy: wikiBusy, lastError: wikiError }
}

async function wikiRebuild(force: boolean): Promise<number> {
  if (force) await wiki.clearIngested()
  const pending = await pendingIngests()
  for (const j of pending) queueIngest(j)
  if (pending.length) await wiki.appendLog('rebuild', `${pending.length} unit(s) queued${force ? ' (forced)' : ''}`)
  return pending.length
}

async function aiConfig() {
  const cfg = await readAiConfig()
  if (!cfg) throw new Error('No API key configured')
  return cfg
}

// ---------- Apple Notes import (via osascript; macOS asks you to allow it the first time) ----------
async function jxa<T>(script: string): Promise<T> {
  const { stdout } = await run('osascript', ['-l', 'JavaScript', '-e', script], { maxBuffer: 256 * 1024 * 1024 })
  return JSON.parse(stdout)
}

async function appleNotesList(): Promise<AppleNoteSummary[]> {
  return jxa<AppleNoteSummary[]>(`
    const app = Application('Notes');
    const out = [];
    for (const f of app.folders()) {
      const folder = f.name();
      for (const n of f.notes()) {
        out.push({ id: n.id(), name: n.name(), folder, modified: n.modificationDate().toISOString(), size: n.plaintext().length });
      }
    }
    JSON.stringify(out);
  `)
}

async function appleNotesImport(ids: string[]): Promise<number> {
  const notes = await jxa<{ id: string; name: string; body: string; created: string; modified: string }[]>(`
    const app = Application('Notes');
    const ids = ${JSON.stringify(ids)};
    const out = [];
    for (const n of app.notes()) {
      if (!ids.includes(n.id())) continue;
      out.push({ id: n.id(), name: n.name(), body: n.body(), created: n.creationDate().toISOString(), modified: n.modificationDate().toISOString() });
    }
    JSON.stringify(out);
  `)
  let count = 0
  for (const n of notes) {
    // Apple Notes puts the title in the first line/heading of the body; drop it from the markdown.
    let md = htmlToMd(n.body)
    const firstLine = md.split('\n')[0]?.replace(/^#+\s*/, '').trim()
    if (firstLine && firstLine === n.name.trim()) md = md.split('\n').slice(1).join('\n').replace(/^\n+/, '')
    md = normalizeAppleMarkdown(md)
    const now = Date.now()
    await store.writeStored({ id: crypto.randomUUID(), title: n.name, body: md, pinned: false, tags: [], absorbed: [], createdAt: Date.parse(n.created) || now, updatedAt: Date.parse(n.modified) || now })
    count++
  }
  if (count) send('notes-changed')
  return count
}

/** Turn Apple Notes conventions into Skribble ones: long dash dividers -> ---, ALL-CAPS label lines -> ### headings, "Title  10/19" bold lines -> ## headings. */
function normalizeAppleMarkdown(md: string): string {
  return md
    .split('\n')
    .map((line) => {
      const t = line.trim()
      if (/^[—–-]{8,}$/.test(t)) return '---'
      const bare = t.replace(/^\*\*|\*\*$/g, '')
      if (/^[A-Z][A-Z /&]{6,}$/.test(bare)) return `### ${bare.charAt(0) + bare.slice(1).toLowerCase()}`
      if (/^\*\*.+\s+\d{1,2}\/\d{1,2}(\/\d{2,4})?\*\*$/.test(t)) return `## ${bare}`
      return line
    })
    .join('\n')
}

// ---------- window & menu ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    title: 'Skribble',
    icon: ICON,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1a' : '#faf9f6',
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: false }
  })
  win.on('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('menu', 'settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    {
      label: 'File',
      submenu: [
        { label: 'New Note', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new-note') },
        { type: 'separator' },
        { label: 'Delete Note', accelerator: 'CmdOrCtrl+Backspace', click: () => send('menu', 'delete-note') },
        { type: 'separator' },
        { label: 'Import from Apple Notes…', click: () => send('menu', 'import-apple') },
        { label: 'Reveal Notes Folder', click: () => shell.openPath(NOTES_DIR) },
        { label: 'Reveal Wiki Folder', click: () => shell.openPath(wiki.WIKI_DIR) },
        { type: 'separator' },
        { label: 'Update Wiki (absorbed but not yet in wiki)', click: () => wikiRebuild(false) },
        { label: 'Rebuild Wiki From Scratch…', click: () => { if (win) { const { dialog } = require('electron'); const r = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Cancel', 'Rebuild'], defaultId: 1, message: 'Re-ingest every absorbed section into the wiki? Existing pages are extended, not deleted.' }); if (r === 1) wikiRebuild(true) } } },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Search', accelerator: 'CmdOrCtrl+F', click: () => send('menu', 'focus-search') },
        { label: 'Notes', accelerator: 'CmdOrCtrl+1', click: () => send('menu', 'view-inbox') },
        { label: 'Wiki', accelerator: 'CmdOrCtrl+2', click: () => send('menu', 'view-brain') },
        { label: 'Back to Notes', accelerator: 'CmdOrCtrl+[', click: () => send('menu', 'go-home') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.setIcon(ICON)
  await store.ensureNotesDir()
  await templates.ensureTemplates()
  const migrated = await store.migrateMarkers()
  await wiki.ensureWiki()
  // catch up on anything absorbed while no key was configured or the app was closed
  setTimeout(() => { wikiRebuild(false).catch((e) => console.error('wiki catch-up failed', e)) }, 3000)
  if (migrated) console.log(`moved absorb markers into frontmatter for ${migrated} note(s)`)

  ipcMain.handle('notes:list', () => listNotes())
  ipcMain.handle('notes:save', async (_e, note: Note) => store.toNote(await store.writeStored(store.fromNote(note))))
  ipcMain.handle('notes:delete', (_e, id: string) => store.deleteStored(id))
  ipcMain.handle('notes:dir', () => NOTES_DIR)
  ipcMain.handle('graph:get', async () => buildGraph(await store.listStored()))
  ipcMain.handle('templates:list', () => templates.listTemplates())
  ipcMain.handle('templates:save', (_e, t: Template) => templates.saveTemplate(t))
  ipcMain.handle('templates:delete', (_e, name: string) => templates.deleteTemplate(name))
  ipcMain.handle('ai:status', async (): Promise<AiStatus> => { const c = await readAiConfig(); return { configured: !!c, model: c?.model } })
  ipcMain.handle('ai:configure', async (_e, cfg: { apiKey: string; model?: string }): Promise<AiStatus> => {
    const prev = await readAiConfig()
    const apiKey = cfg.apiKey === '__keep__' && prev ? prev.apiKey : cfg.apiKey
    await writeAiConfig({ apiKey, model: cfg.model })
    const c = await readAiConfig()
    if (c) setTimeout(() => { wikiRebuild(false).catch(() => undefined) }, 500)
    return { configured: !!c, model: c?.model }
  })
  ipcMain.handle('ai:suggest', async (_e, req: SuggestRequest) => { const cfg = await aiConfig(); return suggestConnections(req, await store.listStored(), cfg) })
  ipcMain.handle('ai:ask', async (_e, req: AskRequest) => { const cfg = await aiConfig(); return ask(req, await store.listStored(), await wiki.listPages(), cfg) })
  ipcMain.handle('wiki:pages', () => wiki.listPages())
  ipcMain.handle('wiki:page', (_e, slug: string) => wiki.readPage(slug))
  ipcMain.handle('wiki:status', () => wikiStatus())
  ipcMain.handle('wiki:rebuild', (_e, force?: boolean) => wikiRebuild(!!force))
  ipcMain.handle('wiki:log', () => wiki.readLog())
  ipcMain.handle('notes:absorb', (_e, req: AbsorbRequest) => absorb(req))
  ipcMain.handle('apple:list', () => appleNotesList())
  ipcMain.handle('apple:import', (_e, ids: string[]) => appleNotesImport(ids))

  buildMenu()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
