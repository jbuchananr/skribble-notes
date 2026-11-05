import { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme } from 'electron'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { Note, Template, AppleNoteSummary, AiStatus, FileRequest, InsightRequest, AskRequest } from '../shared/types'
import { NOTES_DIR } from '../core/paths'
import * as store from '../core/store'
import { buildGraph } from '../core/graph'
import { htmlToMd } from '../core/markdown'
import * as templates from '../core/templates'
import { readAiConfig, writeAiConfig } from '../core/ai/config'
import { suggestFiling } from '../core/ai/file'
import { ask } from '../core/ai/ask'
import { addInsight } from '../core/insights'

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
    await store.writeStored({ id: crypto.randomUUID(), title: n.name, body: md, pinned: false, tags: [], createdAt: Date.parse(n.created) || now, updatedAt: Date.parse(n.modified) || now })
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
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Note', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new-note') },
        { type: 'separator' },
        { label: 'Delete Note', accelerator: 'CmdOrCtrl+Backspace', click: () => send('menu', 'delete-note') },
        { type: 'separator' },
        { label: 'Import from Apple Notes…', click: () => send('menu', 'import-apple') },
        { label: 'Reveal Notes Folder', click: () => shell.openPath(NOTES_DIR) },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Search', accelerator: 'CmdOrCtrl+F', click: () => send('menu', 'focus-search') },
        { label: 'Review Pile', accelerator: 'CmdOrCtrl+1', click: () => send('menu', 'view-review') },
        { label: 'Reviewed Notes', accelerator: 'CmdOrCtrl+2', click: () => send('menu', 'view-reviewed') },
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

  ipcMain.handle('notes:list', () => listNotes())
  ipcMain.handle('notes:save', async (_e, note: Note) => store.toNote(await store.writeStored(store.fromNote(note))))
  ipcMain.handle('notes:delete', (_e, id: string) => store.deleteStored(id))
  ipcMain.handle('notes:dir', () => NOTES_DIR)
  ipcMain.handle('graph:get', async () => buildGraph(await store.listStored()))
  ipcMain.handle('templates:list', () => templates.listTemplates())
  ipcMain.handle('templates:save', (_e, t: Template) => templates.saveTemplate(t))
  ipcMain.handle('templates:delete', (_e, name: string) => templates.deleteTemplate(name))
  ipcMain.handle('ai:status', async (): Promise<AiStatus> => { const c = await readAiConfig(); return { configured: !!c, model: c?.model } })
  ipcMain.handle('ai:configure', async (_e, cfg: { apiKey: string; model?: string }): Promise<AiStatus> => { await writeAiConfig(cfg); const c = await readAiConfig(); return { configured: !!c, model: c?.model } })
  ipcMain.handle('ai:file', async (_e, req: FileRequest) => { const cfg = await aiConfig(); return suggestFiling(req, await store.listStored(), cfg.apiKey, cfg.model) })
  ipcMain.handle('ai:ask', async (_e, req: AskRequest) => { const cfg = await aiConfig(); return ask(req, await store.listStored(), cfg.apiKey, cfg.model) })
  ipcMain.handle('insights:add', async (_e, req: InsightRequest) => { const id = await addInsight(req); send('notes-changed'); return id })
  ipcMain.handle('apple:list', () => appleNotesList())
  ipcMain.handle('apple:import', (_e, ids: string[]) => appleNotesImport(ids))

  buildMenu()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
