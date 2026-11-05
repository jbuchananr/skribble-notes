import { forwardRef, useMemo } from 'react'
import type { GraphNode, Note } from '../../../shared/types'
import { groupLabel, shortTime } from '@/lib/dates'
import { displayTitle } from '@/lib/notes'
import { reviewQueue, reviewedUnits, unitTime } from '../../../core/review'
import { Plus, Search, Pin, FileText, Inbox, CheckCheck, ChevronRight } from './Icons'
import { Ask } from './Ask'
import logo from '../../../../assets/logo-mark.png'

export type HomeView = 'review' | 'reviewed' | 'all'

interface Props {
  notes: Note[]
  graph: GraphNode[]
  view: HomeView
  setView: (v: HomeView) => void
  query: string
  setQuery: (q: string) => void
  onOpen: (id: string, section?: string) => void
  onNew: () => void
}

const fmtReviewed = (iso: string) => { const t = Date.parse(iso + 'T12:00:00'); return Number.isNaN(t) ? iso : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }

export const Home = forwardRef<HTMLInputElement, Props>(function Home({ notes, graph, view, setView, query, setQuery, onOpen, onNew }, searchRef) {
  const q = query.trim().toLowerCase()
  const match = (n: GraphNode) => !q || n.noteTitle.toLowerCase().includes(q) || (n.section ?? '').toLowerCase().includes(q) || n.preview.toLowerCase().includes(q) || n.tags.some((t) => t.includes(q))

  const queue = useMemo(() => reviewQueue(graph), [graph])
  const reviewed = useMemo(() => reviewedUnits(graph), [graph])
  const queueShown = queue.filter(match)
  const reviewedShown = reviewed.filter(match)
  const notesShown = notes.filter((n) => !q || n.title.toLowerCase().includes(q) || (n.text ?? '').toLowerCase().includes(q))

  const queueGroups = useMemo(() => {
    const out: { label: string; items: GraphNode[] }[] = []
    for (const u of queueShown) {
      const label = groupLabel(unitTime(u))
      const g = out[out.length - 1]
      if (g && g.label === label) g.items.push(u); else out.push({ label, items: [u] })
    }
    return out
  }, [queueShown])

  const noteGroups = useMemo(() => {
    const out: { label: string; items: Note[] }[] = []
    const pinned = notesShown.filter((n) => n.pinned)
    if (pinned.length) out.push({ label: 'Pinned', items: pinned })
    for (const n of notesShown.filter((n) => !n.pinned)) {
      const label = groupLabel(n.updatedAt)
      const g = out[out.length - 1]
      if (g && g.label === label) g.items.push(n); else out.push({ label, items: [n] })
    }
    return out
  }, [notesShown])

  const placeholder = view === 'review' ? 'Search the review pile' : view === 'reviewed' ? 'Search reviewed sections' : 'Search all notes'

  return (
    <div className="home">
      <div className="home-drag" />
      <div className="home-inner">
        <header className="home-header">
          <h1><img className="logo" src={logo} alt="" /> Skribble</h1>
          <div className="home-actions">
            <button className="btn-primary" onClick={onNew}><Plus /> New note</button>
          </div>
        </header>

        <div className="home-tabs">
          <button className={view === 'review' ? 'on' : ''} onClick={() => setView('review')}><Inbox /> To review {queue.length > 0 && <span className="n">{queue.length}</span>}</button>
          <button className={view === 'reviewed' ? 'on' : ''} onClick={() => setView('reviewed')}><CheckCheck /> Reviewed {reviewed.length > 0 && <span className="n">{reviewed.length}</span>}</button>
          <button className={view === 'all' ? 'on' : ''} onClick={() => setView('all')}><FileText /> All notes</button>
        </div>

        <label className="search">
          <Search />
          <input
            ref={searchRef}
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); (e.target as HTMLInputElement).blur() } }}
          />
        </label>

        {view === 'review' && (
          <>
            {queueShown.length === 0 && (
              <div className="home-empty">
                <CheckCheck />
                <p>{q ? 'Nothing in the pile matches.' : queue.length === 0 && notes.length > 0 ? 'Pile is empty. Everything you wrote is reviewed.' : 'Notes you write land here until you review them. Press ⌘N to start one.'}</p>
              </div>
            )}
            {queueGroups.map((g) => (
              <section key={g.label} className="group">
                <h2>{g.label}</h2>
                <div className="cards">
                  {g.items.map((u) => (
                    <button key={u.id} className="card review-card" onClick={() => onOpen(u.noteId, u.section)}>
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
          </>
        )}

        {view === 'reviewed' && (
          <>
            <Ask onOpen={onOpen} reviewedCount={reviewed.length} />
            {reviewedShown.length === 0 && (
              <div className="home-empty">
                <CheckCheck />
                <p>{q ? 'No reviewed section matches.' : 'Nothing reviewed yet. Open a note, pick a section in the File tab, and mark it reviewed.'}</p>
              </div>
            )}
            {reviewedShown.length > 0 && (
              <section className="group">
                <div className="cards">
                  {reviewedShown.map((u) => (
                    <button key={u.id} className="card review-card done" onClick={() => onOpen(u.noteId, u.section)}>
                      <div className="card-top">
                        <span className="card-title">{u.noteTitle || 'Untitled'}{u.section && <><ChevronRight className="sep-icon" />{u.section}</>}</span>
                        <span className="card-time" title="Reviewed">{u.reviewed && fmtReviewed(u.reviewed)}</span>
                      </div>
                      <div className="card-snippet">{u.preview || 'No additional text'}</div>
                      {(u.tags.length > 0 || u.links.length > 0) && (
                        <div className="card-sources">
                          {u.links.length > 0 && <span>{u.links.length} link{u.links.length === 1 ? '' : 's'}</span>}
                          {u.tags.map((t) => <span key={t} className="tag">#{t}</span>)}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {view === 'all' && (
          <>
            {notesShown.length === 0 && (
              <div className="home-empty">
                <FileText />
                <p>{q ? 'No notes match your search.' : 'Nothing here yet. Press ⌘N to start a note.'}</p>
              </div>
            )}
            {noteGroups.map((g) => (
              <section key={g.label} className="group">
                <h2>{g.label}</h2>
                <div className="cards">
                  {g.items.map((n) => {
                    const pending = graph.filter((x) => x.noteId === n.id && !x.reviewed && x.level > 0 && x.level <= 2 && x.preview.length >= 20).length
                    return (
                      <button key={n.id} className="card" onClick={() => onOpen(n.id)}>
                        <div className="card-top">
                          <span className="card-title">{n.pinned && <Pin />}{displayTitle(n)}</span>
                          <span className="card-time">{shortTime(n.updatedAt)}</span>
                        </div>
                        <div className="card-snippet">{n.preview || 'No additional text'}</div>
                        {pending > 0 && <div className="card-sources"><Inbox /> {pending} to review</div>}
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  )
})
