import { contextBridge, ipcRenderer } from 'electron'
import type { NotesApi, Note, Template, SuggestRequest, AbsorbRequest, AskRequest, ActionsEdit } from '../shared/types'

const on = (channel: string) => (cb: (...a: never[]) => void) => {
  const handler = (_e: unknown, ...args: unknown[]) => (cb as (...a: unknown[]) => void)(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: NotesApi = {
  listNotes: () => ipcRenderer.invoke('notes:list'),
  saveNote: (note: Note) => ipcRenderer.invoke('notes:save', note),
  deleteNote: (id: string) => ipcRenderer.invoke('notes:delete', id),
  getGraph: () => ipcRenderer.invoke('graph:get'),
  notesDir: () => ipcRenderer.invoke('notes:dir'),
  listTemplates: () => ipcRenderer.invoke('templates:list'),
  saveTemplate: (t: Template) => ipcRenderer.invoke('templates:save', t),
  deleteTemplate: (name: string) => ipcRenderer.invoke('templates:delete', name),
  appleNotesList: () => ipcRenderer.invoke('apple:list'),
  appleNotesImport: (ids: string[]) => ipcRenderer.invoke('apple:import', ids),
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  aiConfigure: (cfg: { apiKey: string; model?: string }) => ipcRenderer.invoke('ai:configure', cfg),
  aiSuggest: (req: SuggestRequest) => ipcRenderer.invoke('ai:suggest', req),
  aiAsk: (req: AskRequest) => ipcRenderer.invoke('ai:ask', req),
  absorb: (req: AbsorbRequest) => ipcRenderer.invoke('notes:absorb', req),
  wikiPages: () => ipcRenderer.invoke('wiki:pages'),
  wikiPage: (slug: string) => ipcRenderer.invoke('wiki:page', slug),
  wikiStatus: () => ipcRenderer.invoke('wiki:status'),
  wikiRebuild: (force?: boolean) => ipcRenderer.invoke('wiki:rebuild', force),
  wikiLog: () => ipcRenderer.invoke('wiki:log'),
  actions: () => ipcRenderer.invoke('actions:get'),
  editActions: (edit: ActionsEdit) => ipcRenderer.invoke('actions:edit', edit),
  onWikiChanged: on('wiki-changed'),
  onMenu: on('menu'),
  onNotesChanged: on('notes-changed')
}

contextBridge.exposeInMainWorld('notes', api)
