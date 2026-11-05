import { useCallback, useEffect, useRef, useState } from 'react'
import type { GraphNode, Note } from '../../shared/types'
import { Home, type HomeView } from './components/Home'
import { Editor } from './components/Editor'
import { ImportModal } from './components/ImportModal'
import { newNote, htmlToText } from './lib/notes'

export default function App() {
  const [notes, setNotes] = useState<Note[]>([])
  const [open, setOpen] = useState<{ id: string; section?: string } | null>(null)
  const [view, setView] = useState<HomeView>('review')
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [graph, setGraph] = useState<GraphNode[]>([])
  const [importing, setImporting] = useState(false)
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
        setNotes((prev) => prev.map((n) => (n.id === saved.id ? { ...n, text: saved.text, preview: saved.preview, tags: saved.tags } : n)))
        if (saveTimers.current.size === 0) { setSaving(false); reload() }
      }, 400)
    )
  }, [reload])

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
    setOpen({ id: n.id })
    setQuery('')
    persist(n)
  }, [persist])

  const deleteNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id))
    setOpen((cur) => (cur?.id === id ? null : cur))
    const t = saveTimers.current.get(id)
    if (t) clearTimeout(t)
    saveTimers.current.delete(id)
    window.notes.deleteNote(id)
  }, [])

  // Leaving an untouched new note discards it, like Apple Notes.
  const goHome = useCallback(() => {
    if (open) {
      const n = notes.find((x) => x.id === open.id)
      if (n && !n.title.trim() && !htmlToText(n.content)) deleteNote(open.id)
    }
    setOpen(null)
  }, [open, notes, deleteNote])

  const openNote = useCallback((id: string, section?: string) => setOpen({ id, section }), [])

  // Menu / keyboard actions from the main process
  useEffect(() => {
    return window.notes.onMenu((action) => {
      switch (action) {
        case 'new-note': createNote(); break
        case 'delete-note': if (open) deleteNote(open.id); break
        case 'focus-search': setOpen(null); setTimeout(() => searchRef.current?.focus(), 0); break
        case 'go-home': goHome(); break
        case 'view-review': setOpen(null); setView('review'); break
        case 'view-reviewed': setOpen(null); setView('reviewed'); break
        case 'import-apple': setImporting(true); break
      }
    })
  }, [createNote, deleteNote, goHome, open])

  // Esc in the editor returns home
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        if (document.querySelector('.context')) { window.dispatchEvent(new CustomEvent('skribble:toggle-panel')); return }
        e.preventDefault(); goHome()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, goHome])

  const openNoteObj = open ? notes.find((n) => n.id === open.id) ?? null : null
  const importModal = importing && <ImportModal onClose={() => setImporting(false)} onDone={(n) => { setImporting(false); reload(); if (n) alert(`Imported ${n} note${n === 1 ? '' : 's'} from Apple Notes.`) }} />

  if (openNoteObj && open) {
    return (
      <>
      {importModal}
      <Editor
        key={open.id + (open.section ?? '')}
        note={openNoteObj}
        saving={saving}
        initialSection={open.section ?? null}
        onChange={(patch) => updateNote(open.id, patch)}
        onDelete={() => deleteNote(open.id)}
        onBack={goHome}
        graph={graph}
        onOpenNote={openNote}
      />
      </>
    )
  }

  return (
    <>
    {importModal}
    <Home
      ref={searchRef}
      notes={notes}
      graph={graph}
      view={view}
      setView={setView}
      query={query}
      setQuery={setQuery}
      onOpen={openNote}
      onNew={createNote}
    />
    </>
  )
}
