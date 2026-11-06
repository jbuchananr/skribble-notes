import type { WikiPage } from '../../../shared/types'
import { FileText, BookOpen, Plus, Settings as SettingsIcon, RefreshCw, Files, PanelLeftClose, ListChecks } from './Icons'
import logo from '../../../../assets/logo-mark.png'
import { ACTIONS_ENABLED } from '../../../shared/features'

export type Nav = { kind: 'notes' } | { kind: 'actions' } | { kind: 'files' } | { kind: 'wiki' } | { kind: 'settings' } | { kind: 'page'; slug: string }

interface Props {
  nav: Nav | null
  notesCount: number
  actionsCount: number
  pages: WikiPage[]
  wikiBusy: boolean
  onNav: (n: Nav) => void
  onNew: () => void
  /** absent while editing, where the toggle sits in the editor toolbar instead */
  onCollapse?: () => void
}

const KIND_ORDER: WikiPage['kind'][] = ['person', 'project', 'decision', 'concept', 'topic']
const KIND_LABEL: Record<WikiPage['kind'], string> = { person: 'People', project: 'Projects', decision: 'Decisions', concept: 'Concepts', topic: 'Topics' }

export function Sidebar({ nav, notesCount, actionsCount, pages, wikiBusy, onNav, onNew, onCollapse }: Props) {
  const on = (k: Nav['kind']) => nav?.kind === k
  return (
    <aside className="sidebar">
      <div className="sidebar-drag" />
      <div className="sidebar-brand">
        <img className="logo" src={logo} alt="" /> <span>Skribble</span>
        {onCollapse && <button className="icon-btn sidebar-toggle" onClick={onCollapse} title="Hide sidebar (⌘\)"><PanelLeftClose /></button>}
      </div>
      <nav className="side-nav">
        <button className={`side-item ${on('notes') ? 'on' : ''}`} onClick={() => onNav({ kind: 'notes' })}>
          <FileText /> <span>Notes</span>{notesCount > 0 && <span className="side-n">{notesCount}</span>}
        </button>
        {ACTIONS_ENABLED && (
          <button className={`side-item ${on('actions') ? 'on' : ''}`} onClick={() => onNav({ kind: 'actions' })}>
            <ListChecks /> <span>Actions</span>{actionsCount > 0 && <span className="side-n">{actionsCount}</span>}
          </button>
        )}
        <button className={`side-item ${on('files') ? 'on' : ''}`} onClick={() => onNav({ kind: 'files' })}>
          <Files /> <span>Files</span>
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
        <button className={`side-item ${on('settings') ? 'on' : ''}`} onClick={() => onNav({ kind: 'settings' })} title="Settings (⌘,)"><SettingsIcon /> <span>Settings</span></button>
      </div>
    </aside>
  )
}
