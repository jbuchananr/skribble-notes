import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphNode, Note, WikiPage, WikiStatus } from '../../shared/types'
import { Sidebar, type Nav } from './components/Sidebar'
import { NotesView } from './components/NotesView'
import { FilesView } from './components/FilesView'
import { PanelLeftOpen } from './components/Icons'
import { WikiChat } from './components/WikiChat'
import { Editor } from './components/Editor'
import { Absorb } from './components/Absorb'
import { WikiPageView } from './components/WikiPage'
import { Settings } from './components/Settings'
import { ImportModal } from './components/ImportModal'
import { newNote, htmlToText } from './lib/notes'
import { inbox } from '../../core/inbox'

type Mode =
  | { kind: 'notes' }
  | { kind: 'files' }
  | { kind: 'wiki' }
  | { kind: 'page'; slug: string }
  | { kind: 'edit'; id: string; section?: string }
  | { kind: 'absorb'; nodeId: string; from: 'notes' | 'edit' }

export default function App() {
  const [notes, setNotes] = useState<Note[]>([])
  const [mode, setMode] = useState<Mode>({ kind: 'notes' })
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [graph, setGraph] = useState<GraphNode[]>([])
  const [pages, setPages] = useState<WikiPage[]>([])
  const [wikiStatus, setWikiStatus] = useState<WikiStatus | null>(null)
  const [importing, setImporting] = useState(false)
  const [settings, setSettings] = useState(false)
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('skribble:sidebar') === 'hidden' } catch { return false } })
  const toggleSidebar = useCallback(() => setCollapsed((c) => {
    try { localStorage.setItem('skribble:sidebar', c ? 'shown' : 'hidden') } catch { /* private storage */ }
    return !c
  }), [])
  const searchRef = useRef<HTMLInputElement>(null)
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const reload = useCallback(async () => {
    const [n, g] = await Promise.all([window.notes.listNotes(), window.notes.getGraph()])
    setNotes(n); setGraph(g)
  }, [])
  const reloadWiki = useCallback(() => { window.notes.wikiPages().then(setPages); window.notes.wikiStatus().then(setWikiStatus) }, [])

  useEffect(() => { reload(); reloadWiki() }, [reload, reloadWiki])
  useEffect(() => window.notes.onNotesChanged(() => { if (saveTimers.current.size === 0) reload() }), [reload])
  useEffect(() => window.notes.onWikiChanged(reloadWiki), [reloadWiki])
  useEffect(() => {
    if (saving) return
    window.notes.getGraph().then(setGraph)
  }, [saving, notes.length])

  const persist = useCallback((note: Note) => {
    setSaving(true)
    const existing = saveTimers.current.get(note.id)
    if (existing) clearTimeout(existing)
    saveTimers.current.set(
      note.id,
      setTimeout(async () => {
        const saved = await window.notes.saveNote(note)
        saveTimers.current.delete(note.id)
        setNotes((prev) => prev.map((n) => (n.id === saved.id ? { ...n, text: saved.text, preview: saved.preview, tags: saved.tags, absorbed: saved.absorbed } : n)))
        if (saveTimers.current.size === 0) { setSaving(false); window.notes.getGraph().then(setGraph) }
      }, 400)
    )
  }, [])

  const updateNote = useCallback((id: string, patch: Partial<Note>) => {
    setNotes((prev) => {
      const idx = prev.findIndex((n) => n.id === id)
      if (idx < 0) return prev
      const next: Note = { ...prev[idx], ...patch, updatedAt: Date.now() }
      if (patch.content !== undefined) next.preview = htmlToText(patch.content.slice(0, 2000)).slice(0, 140)
      persist(next)
      const copy = prev.slice()
      copy[idx] = next
      return copy
    })
  }, [persist])

  const createNote = useCallback(() => {
    const n = newNote()
    setNotes((prev) => [n, ...prev])
    setMode({ kind: 'edit', id: n.id })
    setQuery('')
    persist(n)
  }, [persist])

  const deleteNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id))
    setMode((m) => (m.kind === 'edit' && m.id === id ? { kind: 'notes' } : m))
    const t = saveTimers.current.get(id)
    if (t) clearTimeout(t)
    saveTimers.current.delete(id)
    window.notes.deleteNote(id)
  }, [])

  // Leaving an untouched new note discards it, like Apple Notes.
  const leaveEditor = useCallback((to: Mode = { kind: 'notes' }) => {
    if (mode.kind === 'edit') {
      const n = notes.find((x) => x.id === mode.id)
      if (n && !n.title.trim() && !htmlToText(n.content)) deleteNote(mode.id)
    }
    setMode(to)
  }, [mode, notes, deleteNote])

  const openNote = useCallback((id: string, section?: string) => setMode({ kind: 'edit', id, section }), [])
  const openPage = useCallback((slug: string) => setMode({ kind: 'page', slug }), [])
  const absorbNode = useCallback((node: GraphNode, from: 'notes' | 'edit' = 'notes') => setMode({ kind: 'absorb', nodeId: node.id, from }), [])
  const openSource = useCallback((ref: string) => {
    const [title, section] = ref.split('#')
    const n = notes.find((x) => x.title.trim().toLowerCase() === title.trim().toLowerCase())
    if (n) setMode({ kind: 'edit', id: n.id, section: section?.trim() || undefined })
  }, [notes])
  const navigate = useCallback((n: Nav) => {
    const to: Mode = n.kind === 'page' ? { kind: 'page', slug: n.slug } : n.kind === 'wiki' ? { kind: 'wiki' } : n.kind === 'files' ? { kind: 'files' } : { kind: 'notes' }
    if (mode.kind === 'edit') leaveEditor(to); else setMode(to)
  }, [mode, leaveEditor])

  useEffect(() => {
    return window.notes.onMenu((action) => {
      switch (action) {
        case 'new-note': createNote(); break
        case 'delete-note': if (mode.kind === 'edit') deleteNote(mode.id); break
        case 'focus-search': navigate({ kind: 'notes' }); setTimeout(() => searchRef.current?.focus(), 0); break
        case 'go-home': if (mode.kind === 'edit') leaveEditor(); else setMode({ kind: 'notes' }); break
        case 'view-inbox': navigate({ kind: 'notes' }); break
        case 'view-brain': navigate({ kind: 'wiki' }); break
        case 'view-all': navigate({ kind: 'files' }); break
        case 'toggle-sidebar': toggleSidebar(); break
        case 'import-apple': setImporting(true); break
        case 'settings': setSettings(true); break
      }
    })
  }, [createNote, deleteNote, leaveEditor, navigate, mode, toggleSidebar])

  // Esc in the editor goes back to Notes (absorb and page views handle their own keys)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && mode.kind === 'edit' && !settings) { e.preventDefault(); leaveEditor() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, leaveEditor, settings])

  const queue = useMemo(() => inbox(graph), [graph])
  const nav: Nav | null = mode.kind === 'notes' ? { kind: 'notes' } : mode.kind === 'files' ? { kind: 'files' } : mode.kind === 'wiki' ? { kind: 'wiki' } : mode.kind === 'page' ? { kind: 'page', slug: mode.slug } : mode.kind === 'absorb' ? { kind: 'notes' } : null

  let main: React.ReactNode = null
  if (mode.kind === 'absorb') {
    const node = graph.find((g) => g.id === mode.nodeId)
    const note = node ? notes.find((n) => n.id === node.noteId) : undefined
    if (node && note) {
      const idx = queue.findIndex((q) => q.id === node.id)
      const position = idx >= 0 ? { index: idx, total: queue.length } : undefined
      const back = () => (mode.from === 'edit' ? setMode({ kind: 'edit', id: note.id, section: node.section }) : setMode({ kind: 'notes' }))
      main = (
        <Absorb
          key={node.id}
          note={note}
          node={node}
          graph={graph}
          position={position}
          onBack={back}
          onEdit={() => setMode({ kind: 'edit', id: note.id, section: node.section })}
          onNav={(d) => { if (idx < 0) return; const n = queue[idx + d]; if (n) setMode({ kind: 'absorb', nodeId: n.id, from: mode.from }) }}
          onAbsorbed={async () => {
            await reload()
            const rest = queue.filter((q) => q.id !== node.id)
            const next = idx >= 0 ? (rest[idx] ?? rest[idx - 1]) : undefined
            if (mode.from === 'notes' && next) setMode({ kind: 'absorb', nodeId: next.id, from: 'notes' })
            else back()
          }}
        />
      )
    } else main = <NotesView ref={searchRef} notes={notes} graph={graph} query={query} setQuery={setQuery} onAbsorb={(n) => absorbNode(n)} onOpen={openNote} />
  } else if (mode.kind === 'edit') {
    const open = notes.find((n) => n.id === mode.id)
    if (open) {
      main = (
        <Editor
          key={open.id}
          note={open}
          saving={saving}
          initialSection={mode.section ?? null}
          graph={graph}
          onChange={(patch) => updateNote(open.id, patch)}
          onDelete={() => deleteNote(open.id)}
          onAbsorb={(section) => {
            const node = graph.find((g) => g.noteId === open.id && (section ? g.section === section : g.level === 0))
            if (node) absorbNode(node, 'edit')
          }}
        />
      )
    }
  } else if (mode.kind === 'page') {
    main = <WikiPageView slug={mode.slug} onBack={() => setMode({ kind: 'wiki' })} onOpenSource={openSource} onOpenPage={openPage} />
  } else if (mode.kind === 'files') {
    main = <FilesView notes={notes} graph={graph} onOpen={(id) => openNote(id)} />
  } else if (mode.kind === 'wiki') {
    main = <WikiChat pageCount={pages.length} onOpen={openNote} onOpenPage={openPage} onSettings={() => setSettings(true)} />
  } else {
    main = <NotesView ref={searchRef} notes={notes} graph={graph} query={query} setQuery={setQuery} onAbsorb={(n) => absorbNode(n)} onOpen={openNote} />
  }

  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
      {!collapsed && <Sidebar nav={nav} notesCount={queue.length} pages={pages} wikiBusy={!!wikiStatus?.busy} onNav={navigate} onNew={createNote} onSettings={() => setSettings(true)} onCollapse={toggleSidebar} />}
      <main className="main">
        {collapsed && <div className="collapsed-bar"><button className="icon-btn" onClick={toggleSidebar} title="Show sidebar (⌘\)"><PanelLeftOpen /></button></div>}
        {main}
      </main>
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={(n) => { setImporting(false); reload(); if (n) alert(`Imported ${n} note${n === 1 ? '' : 's'} from Apple Notes.`) }} />}
      {settings && <Settings onClose={() => setSettings(false)} />}
    </div>
  )
}
