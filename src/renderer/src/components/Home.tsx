import { forwardRef, useMemo } from 'react'
import type { GraphNode, Note } from '../../../shared/types'
import { groupLabel, shortTime } from '@/lib/dates'
import { displayTitle } from '@/lib/notes'
import { inbox, brain, unitTime } from '../../../core/inbox'
import { Plus, Search, Pin, FileText, Inbox, Brain, ChevronRight, Lightbulb } from './Icons'
import { Ask } from './Ask'
import logo from '../../../../assets/logo-mark.png'

export type HomeView = 'inbox' | 'brain' | 'all'

interface Props {
  notes: Note[]
  graph: GraphNode[]
  view: HomeView
  setView: (v: HomeView) => void
  query: string
  setQuery: (q: string) => void
  onAbsorb: (node: GraphNode) => void
  onOpen: (id: string, section?: string) => void
  onNew: () => void
}

const fmtDay = (iso: string) => { const t = Date.parse(iso + 'T12:00:00'); return Number.isNaN(t) ? iso : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }

export const Home = forwardRef<HTMLInputElement, Props>(function Home({ notes, graph, view, setView, query, setQuery, onAbsorb, onOpen, onNew }, searchRef) {
  const q = query.trim().toLowerCase()
  const match = (n: GraphNode) => !q || n.noteTitle.toLowerCase().includes(q) || (n.section ?? '').toLowerCase().includes(q) || n.preview.toLowerCase().includes(q) || n.tags.some((t) => t.includes(q))

  const queue = useMemo(() => inbox(graph), [graph])
  const mind = useMemo(() => brain(graph), [graph])
  const queueShown = queue.filter(match)
  const mindShown = mind.filter(match)
  const notesShown = notes.filter((n) => !q || n.title.toLowerCase().includes(q) || (n.text ?? '').toLowerCase().includes(q))

  const groupBy = <T,>(items: T[], when: (t: T) => number) => {
    const out: { label: string; items: T[] }[] = []
    for (const it of items) {
      const l = groupLabel(when(it))
      const g = out[out.length - 1]
      if (g && g.label === l) g.items.push(it); else out.push({ label: l, items: [it] })
    }
    return out
  }
  const queueGroups = useMemo(() => groupBy(queueShown, unitTime), [queueShown])
  const noteGroups = useMemo(() => {
    const out: { label: string; items: Note[] }[] = []
    const pinned = notesShown.filter((n) => n.pinned)
    if (pinned.length) out.push({ label: 'Pinned', items: pinned })
    return [...out, ...groupBy(notesShown.filter((n) => !n.pinned), (n) => n.updatedAt)]
  }, [notesShown])

  const placeholder = view === 'inbox' ? 'Search notes' : view === 'brain' ? 'Search your brain' : 'Search everything'

  return (
    <div className="home">
      <div className="home-drag" />
      <div className="home-inner">
        <header className="home-header">
          <h1><img className="logo" src={logo} alt="" /> Skribble</h1>
          <button className="btn-primary" onClick={onNew}><Plus /> New note</button>
        </header>

        <div className="home-tabs">
          <button className={view === 'inbox' ? 'on' : ''} onClick={() => setView('inbox')}><FileText /> Notes {queue.length > 0 && <span className="n">{queue.length}</span>}</button>
          <button className={view === 'brain' ? 'on' : ''} onClick={() => setView('brain')}><Brain /> Brain {mind.length > 0 && <span className="n muted">{mind.length}</span>}</button>
          <button className={view === 'all' ? 'on' : ''} onClick={() => setView('all')}><Inbox /> All</button>
        </div>

        {view === 'brain' && <Ask onOpen={onOpen} brainCount={mind.length} />}

        <label className="search">
          <Search />
          <input ref={searchRef} placeholder={placeholder} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); (e.target as HTMLInputElement).blur() } }} />
        </label>

        {view === 'inbox' && (
          <>
            {queueShown.length === 0 && (
              <div className="home-empty">
                <Inbox />
                <p>{q ? 'No notes match.' : queue.length === 0 && notes.length > 0 ? 'All caught up. Everything you wrote is in your brain.' : 'Whatever you write lands here until you absorb it. Press ⌘N to start a note.'}</p>
              </div>
            )}
            {queueGroups.map((g) => (
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
          </>
        )}

        {view === 'brain' && (
          <>
            {mindShown.length === 0 && (
              <div className="home-empty">
                <Brain />
                <p>{q ? 'Nothing in your brain matches.' : 'Empty so far. Absorb a note and it shows up here.'}</p>
              </div>
            )}
            {mindShown.length > 0 && (
              <section className="group">
                <div className="cards">
                  {mindShown.map((u) => u.insight ? (
                    <button key={u.id} className="card insight-card" onClick={() => onOpen(u.noteId, u.section)}>
                      <Lightbulb />
                      <span className="insight-text">{u.section}</span>
                      <span className="card-time">{shortTime(u.updatedAt)}</span>
                    </button>
                  ) : (
                    <button key={u.id} className="card unit-card done" onClick={() => onAbsorb(u)} title="Open to re-absorb">
                      <div className="card-top">
                        <span className="card-title">{u.noteTitle || 'Untitled'}{u.section && <><ChevronRight className="sep-icon" />{u.section}</>}</span>
                        <span className="card-time">{u.absorbed && fmtDay(u.absorbed)}</span>
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
                    const pending = queue.filter((x) => x.noteId === n.id).length
                    return (
                      <button key={n.id} className="card" onClick={() => onOpen(n.id)}>
                        <div className="card-top">
                          <span className="card-title">{n.pinned && <Pin />}{displayTitle(n)}</span>
                          <span className="card-time">{shortTime(n.updatedAt)}</span>
                        </div>
                        <div className="card-snippet">{n.preview || 'No additional text'}</div>
                        {pending > 0 && <div className="card-sources"><Brain /> {pending} to absorb</div>}
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
