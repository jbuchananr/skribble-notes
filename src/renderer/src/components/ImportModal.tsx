import { useEffect, useMemo, useState } from 'react'
import type { AppleNoteSummary } from '../../../shared/types'
import { Search, X } from './Icons'

export function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: (n: number) => void }) {
  const [notes, setNotes] = useState<AppleNoteSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.notes.appleNotesList().then(setNotes).catch((e) => setError(String(e?.message ?? e)))
  }, [])

  const visible = useMemo(() => {
    const s = q.toLowerCase()
    return (notes ?? []).filter((n) => !s || n.name.toLowerCase().includes(s) || n.folder.toLowerCase().includes(s))
      .sort((a, b) => b.modified.localeCompare(a.modified))
  }, [notes, q])

  const toggle = (id: string) => setSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const doImport = async () => {
    setBusy(true)
    try { onDone(await window.notes.appleNotesImport([...sel])) } catch (e) { setError(String((e as Error).message)) } finally { setBusy(false) }
  }

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-head">
          <strong>Import from Apple Notes</strong>
          <button className="mini" onClick={onClose}><X /></button>
        </div>
        {error && <div className="banner">{error.includes('1743') || error.toLowerCase().includes('not authorized') ? 'macOS blocked access. Allow Skribble under System Settings → Privacy & Security → Automation → Notes, then try again.' : error}</div>}
        {!notes && !error && <div className="modal-empty">Reading your Apple Notes… macOS may ask you to allow it.</div>}
        {notes && (
          <>
            <label className="search" style={{ margin: '0 0 10px' }}><Search /><input autoFocus placeholder="Search notes or folders" value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <div className="modal-list">
              {visible.map((n) => (
                <label key={n.id} className="modal-row">
                  <input type="checkbox" checked={sel.has(n.id)} onChange={() => toggle(n.id)} />
                  <span className="modal-row-name">{n.name || 'Untitled'}</span>
                  <span className="source-meta">{n.folder} · {Math.round(n.size / 1000)}k chars</span>
                </label>
              ))}
              {visible.length === 0 && <div className="modal-empty">No notes match.</div>}
            </div>
            <div className="modal-foot">
              <span className="source-meta">{sel.size} selected · imported notes become markdown files in ~/Notes</span>
              <button className="btn-primary" disabled={!sel.size || busy} onClick={doImport}>{busy ? 'Importing…' : `Import ${sel.size || ''}`}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
