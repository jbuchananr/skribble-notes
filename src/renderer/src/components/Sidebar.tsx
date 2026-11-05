import type { WikiPage } from '../../../shared/types'
import { FileText, BookOpen, Plus, Settings as SettingsIcon, RefreshCw } from './Icons'
import logo from '../../../../assets/logo-mark.png'

export type Nav = { kind: 'notes' } | { kind: 'wiki' } | { kind: 'page'; slug: string }

interface Props {
  nav: Nav | null
  notesCount: number
  pages: WikiPage[]
  wikiBusy: boolean
  onNav: (n: Nav) => void
  onNew: () => void
  onSettings: () => void
}

const KIND_ORDER: WikiPage['kind'][] = ['person', 'project', 'decision', 'concept', 'topic']
const KIND_LABEL: Record<WikiPage['kind'], string> = { person: 'People', project: 'Projects', decision: 'Decisions', concept: 'Concepts', topic: 'Topics' }

export function Sidebar({ nav, notesCount, pages, wikiBusy, onNav, onNew, onSettings }: Props) {
  const on = (k: Nav['kind']) => nav?.kind === k
  return (
    <aside className="sidebar">
      <div className="sidebar-drag" />
      <div className="sidebar-brand"><img className="logo" src={logo} alt="" /> Skribble</div>
      <nav className="side-nav">
        <button className={`side-item ${on('notes') ? 'on' : ''}`} onClick={() => onNav({ kind: 'notes' })}>
          <FileText /> <span>Notes</span>{notesCount > 0 && <span className="side-n">{notesCount}</span>}
        </button>
        <button className={`side-item ${on('wiki') ? 'on' : ''}`} onClick={() => onNav({ kind: 'wiki' })}>
          <BookOpen /> <span>Wiki</span>{wikiBusy && <RefreshCw className="spin side-spin" />}
        </button>
        {pages.length > 0 && (
          <div className="side-pages">
            {KIND_ORDER.map((k) => {
              const mine = pages.filter((p) => p.kind === k).sort((a, b) => a.title.localeCompare(b.title))
              if (!mine.length) return null
              return (
                <div key={k} className="side-group">
                  <div className="side-group-label">{KIND_LABEL[k]}</div>
                  {mine.map((p) => (
                    <button key={p.slug} className={`side-page ${nav?.kind === 'page' && nav.slug === p.slug ? 'on' : ''}`} onClick={() => onNav({ kind: 'page', slug: p.slug })} title={p.summary}>{p.title}</button>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </nav>
      <div className="side-foot">
        <button className="side-item" onClick={onNew} title="New note (⌘N)"><Plus /> <span>New note</span></button>
        <button className="side-item" onClick={onSettings} title="Settings (⌘,)"><SettingsIcon /> <span>Settings</span></button>
      </div>
    </aside>
  )
}
