import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphNode, Note } from '../../shared/types'
import { Home, type HomeView } from './components/Home'
import { Editor } from './components/Editor'
import { Absorb } from './components/Absorb'
import { WikiPageView } from './components/WikiPage'
import { Settings } from './components/Settings'
import { ImportModal } from './components/ImportModal'
import { newNote, htmlToText } from './lib/notes'
import { inbox } from '../../core/inbox'

type Mode = { kind: 'home' } | { kind: 'edit'; id: string; section?: string } | { kind: 'absorb'; nodeId: string; from: 'inbox' | 'edit' } | { kind: 'wiki'; slug: string }

export default function App() {
  const [notes, setNotes] = useState<Note[]>([])
  const [mode, setMode] = useState<Mode>({ kind: 'home' })
  const [view, setView] = useState<HomeView>('inbox')
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [graph, setGraph] = useState<GraphNode[]>([])
  const [importing, setImporting] = useState(false)
  const [settings, setSettings] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const reload = useCallback(async () => {
    const [n, g] = await Promise.all([window.notes.listNotes(), window.notes.getGraph()])
    setNotes(n); setGraph(g)
  }, [])

  useEffect(() => { reload() }, [reload])
  useEffect(() => window.notes.onNotesChanged(() => { if (saveTimers.current.size === 0) reload() }), [reload])
  // refresh the graph after edits settle
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
        // take derived fields (search text, preview, tags) from disk; never overwrite content being typed
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
    setMode((m) => (m.kind === 'edit' && m.id === id ? { kind: 'home' } : m))
    const t = saveTimers.current.get(id)
    if (t) clearTimeout(t)
    saveTimers.current.delete(id)
    window.notes.deleteNote(id)
  }, [])

  // Leaving an untouched new note discards it, like Apple Notes.
  const goHome = useCallback(() => {
    if (mode.kind === 'edit') {
      const n = notes.find((x) => x.id === mode.id)
      if (n && !n.title.trim() && !htmlToText(n.content)) deleteNote(mode.id)
    }
    setMode({ kind: 'home' })
  }, [mode, notes, deleteNote])

  const openNote = useCallback((id: string, section?: string) => setMode({ kind: 'edit', id, section }), [])
  const openPage = useCallback((slug: string) => setMode({ kind: 'wiki', slug }), [])
  /** "Note Title#Section" from a wiki citation */
  const openSource = useCallback((ref: string) => {
    const [title, section] = ref.split('#')
    const n = notes.find((x) => x.title.trim().toLowerCase() === title.trim().toLowerCase())
    if (n) setMode({ kind: 'edit', id: n.id, section: section?.trim() || undefined })
  }, [notes])
  const absorbNode = useCallback((node: GraphNode, from: 'inbox' | 'edit' = 'inbox') => setMode({ kind: 'absorb', nodeId: node.id, from }), [])

  // Menu / keyboard actions from the main process
  useEffect(() => {
    return window.notes.onMenu((action) => {
      switch (action) {
        case 'new-note': createNote(); break
        case 'delete-note': if (mode.kind === 'edit') deleteNote(mode.id); break
        case 'focus-search': setMode({ kind: 'home' }); setTimeout(() => searchRef.current?.focus(), 0); break
        case 'go-home': goHome(); break
        case 'view-inbox': setMode({ kind: 'home' }); setView('inbox'); break
        case 'view-brain': setMode({ kind: 'home' }); setView('brain'); break
        case 'view-all': setMode({ kind: 'home' }); setView('all'); break
        case 'import-apple': setImporting(true); break
        case 'settings': setSettings(true); break
      }
    })
  }, [createNote, deleteNote, goHome, mode])

  // Esc in the editor returns home (the absorb screen handles its own keys)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && mode.kind === 'edit') { e.preventDefault(); goHome() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, goHome])

  const queue = useMemo(() => inbox(graph), [graph])
  const overlays = <>{importing && <ImportModal onClose={() => setImporting(false)} onDone={(n) => { setImporting(false); reload(); if (n) alert(`Imported ${n} note${n === 1 ? '' : 's'} from Apple Notes.`) }} />}{settings && <Settings onClose={() => setSettings(false)} />}</>

  if (mode.kind === 'wiki') {
    return (
      <>
      {overlays}
      <WikiPageView slug={mode.slug} onBack={() => setMode({ kind: 'home' })} onOpenSource={openSource} onOpenPage={openPage} />
      </>
    )
  }

  if (mode.kind === 'absorb') {
    const node = graph.find((g) => g.id === mode.nodeId)
    const note = node ? notes.find((n) => n.id === node.noteId) : undefined
    if (node && note) {
      const idx = queue.findIndex((q) => q.id === node.id)
      const position = idx >= 0 ? { index: idx, total: queue.length } : undefined
      const back = () => (mode.from === 'edit' ? setMode({ kind: 'edit', id: note.id, section: node.section }) : setMode({ kind: 'home' }))
      return (
        <>
        {overlays}
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
            // move on: the next item in the inbox, or back where we came from
            const rest = queue.filter((q) => q.id !== node.id)
            const next = idx >= 0 ? (rest[idx] ?? rest[idx - 1]) : undefined
            if (mode.from === 'inbox' && next) setMode({ kind: 'absorb', nodeId: next.id, from: 'inbox' })
            else back()
          }}
        />
        </>
      )
    }
  }

  if (mode.kind === 'edit') {
    const open = notes.find((n) => n.id === mode.id)
    if (open) {
      return (
        <>
        {overlays}
        <Editor
          key={open.id}
          note={open}
          saving={saving}
          initialSection={mode.section ?? null}
          graph={graph}
          onChange={(patch) => updateNote(open.id, patch)}
          onDelete={() => deleteNote(open.id)}
          onBack={goHome}
          onAbsorb={(section) => {
            const node = graph.find((g) => g.noteId === open.id && (section ? g.section === section : g.level === 0))
            if (node) absorbNode(node, 'edit')
          }}
        />
        </>
      )
    }
  }

  return (
    <>
    {overlays}
    <Home
      ref={searchRef}
      notes={notes}
      graph={graph}
      view={view}
      setView={setView}
      query={query}
      setQuery={setQuery}
      onAbsorb={(node) => absorbNode(node, 'inbox')}
      onOpen={openNote}
      onOpenPage={openPage}
      onSettings={() => setSettings(true)}
      onNew={createNote}
    />
    </>
  )
}
