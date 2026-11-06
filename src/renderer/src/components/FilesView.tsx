import { useMemo, useState } from 'react'
import type { GraphNode, Note } from '../../../shared/types'
import { shortTime } from '@/lib/dates'
import { displayTitle } from '@/lib/notes'
import { noteMarkdown } from '@/lib/copy'
import { previewHtml } from '@/lib/sanitize'
import { isUnit } from '../../../core/inbox'
import { Search, Files, FileText } from './Icons'
import { CopyButton } from './CopyButton'

interface Props {
  notes: Note[]
  graph: GraphNode[]
  onOpen: (id: string) => void
}

/** Every note on disk as a gallery of cards, most recently edited first. */
export function FilesView({ notes, graph, onOpen }: Props) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  // per note: how many of its sections are still waiting to be absorbed, and how many are done
  const status = useMemo(() => {
    const out = new Map<string, { waiting: number; done: number }>()
    for (const g of graph) {
      if (!isUnit(g, graph)) continue
      const s = out.get(g.noteId) ?? { waiting: 0, done: 0 }
      if (g.absorbed) s.done++; else s.waiting++
      out.set(g.noteId, s)
    }
    return out
  }, [graph])

  const shown = useMemo(() => notes
    .filter((n) => !q || n.title.toLowerCase().includes(q) || (n.text ?? '').toLowerCase().includes(q) || n.tags.some((t) => t.includes(q)))
    .sort((a, b) => b.updatedAt - a.updatedAt), [notes, q])

  return (
    <div className="view">
      <div className="view-inner wide">
        <div className="files-head">
          <h1 className="view-title">Files</h1>
          <label className="search files-search">
            <Search />
            <input placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); (e.target as HTMLInputElement).blur() } }} />
          </label>
        </div>
        <h2 className="files-sub">{q ? `${shown.length} match${shown.length === 1 ? '' : 'es'}` : 'All notes'}</h2>

        {shown.length === 0 && (
          <div className="home-empty">
            <Files />
            <p>{q ? 'No note matches.' : 'No notes yet. Press ⌘N to start one.'}</p>
          </div>
        )}
        <div className="doc-grid">
          {shown.map((n) => {
            const s = status.get(n.id)
            const state = s ? (s.waiting > 0 ? `${s.waiting} to absorb` : s.done > 0 ? 'Absorbed' : '') : ''
            return (
              <div key={n.id} className="doc-card-wrap">
                <button className="doc-card" onClick={() => onOpen(n.id)}>
                  <div className="doc-preview" aria-hidden>
                    <div className="doc-preview-title">{displayTitle(n)}</div>
                    <div className="doc-preview-body" dangerouslySetInnerHTML={{ __html: previewHtml(n.content) }} />
                  </div>
                  <div className="doc-meta">
                    <FileText className="doc-icon" />
                    <div className="doc-meta-text">
                      <div className="doc-name">{displayTitle(n)}</div>
                      <div className="doc-sub">Edited {shortTime(n.updatedAt)}{state && <> · <span className={s && s.waiting > 0 ? 'doc-waiting' : ''}>{state}</span></>}</div>
                    </div>
                  </div>
                </button>
                <div className="doc-actions"><CopyButton title="Copy note as markdown" text={() => noteMarkdown(n)} /></div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
