import { forwardRef, useMemo } from 'react'
import type { GraphNode, Note } from '../../../shared/types'
import { groupLabel, shortTime } from '@/lib/dates'
import { displayTitle } from '@/lib/notes'
import { inbox, unitTime } from '../../../core/inbox'
import { Search, ChevronRight, BookOpen, Pin } from './Icons'

interface Props {
  notes: Note[]
  graph: GraphNode[]
  query: string
  setQuery: (q: string) => void
  onAbsorb: (node: GraphNode) => void
  onOpen: (id: string, section?: string) => void
}

/** Notes = anything you have written and not yet sent to the wiki. Search reaches every note. */
export const NotesView = forwardRef<HTMLInputElement, Props>(function NotesView({ notes, graph, query, setQuery, onAbsorb, onOpen }, searchRef) {
  const q = query.trim().toLowerCase()
  const queue = useMemo(() => inbox(graph), [graph])
  const shown = queue.filter((n) => !q || n.noteTitle.toLowerCase().includes(q) || (n.section ?? '').toLowerCase().includes(q) || n.preview.toLowerCase().includes(q) || n.tags.some((t) => t.includes(q)))
  const groups = useMemo(() => {
    const out: { label: string; items: GraphNode[] }[] = []
    for (const u of shown) {
      const l = groupLabel(unitTime(u))
      const g = out[out.length - 1]
      if (g && g.label === l) g.items.push(u); else out.push({ label: l, items: [u] })
    }
    return out
  }, [shown])
  // with a query, also surface whole notes (absorbed ones included) so anything can be reopened
  const matchingNotes = q ? notes.filter((n) => n.title.toLowerCase().includes(q) || (n.text ?? '').toLowerCase().includes(q)) : []

  return (
    <div className="view">
      <div className="view-inner">
        <h1 className="view-title">Notes</h1>
        <label className="search">
          <Search />
          <input ref={searchRef} placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); (e.target as HTMLInputElement).blur() } }} />
        </label>

        {shown.length === 0 && (
          <div className="home-empty">
            <BookOpen />
            <p>{q ? 'Nothing waiting matches.' : queue.length === 0 && notes.length > 0 ? 'All caught up. Everything you wrote is in the wiki.' : 'Whatever you write lands here until you send it to the wiki. Press ⌘N to start a note.'}</p>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.label} className="group">
            <h2>{g.label}</h2>
            <div className="cards">
              {g.items.map((u) => (
                <button key={u.id} className="card unit-card" onClick={() => onAbsorb(u)}>
                  <div className="card-top">
                    <span className="card-title">{u.noteTitle || 'Untitled'}{u.section && <><ChevronRight className="sep-icon" />{u.section}</>}</span>
                    <span className="card-time">{shortTime(unitTime(u))}</span>
                  </div>
                  <div className="card-snippet">{u.preview || 'No additional text'}</div>
                </button>
              ))}
            </div>
          </section>
        ))}

        {matchingNotes.length > 0 && (
          <section className="group">
            <h2>Open a note</h2>
            <div className="cards">
              {matchingNotes.map((n) => (
                <button key={n.id} className="card" onClick={() => onOpen(n.id)}>
                  <div className="card-top"><span className="card-title">{n.pinned && <Pin />}{displayTitle(n)}</span><span className="card-time">{shortTime(n.updatedAt)}</span></div>
                  <div className="card-snippet">{n.preview || 'No additional text'}</div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
})
