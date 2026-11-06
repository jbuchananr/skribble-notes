import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActionItem, ActionKind, ActionList, ActionsEdit, ActionsState } from '../../../shared/types'
import { Circle, CircleCheck, X, Pencil, Plus, RefreshCw } from './Icons'
import { CopyButton } from './CopyButton'

interface Props {
  onOpenNote: (id: string) => void
  /** open the section an item came from, "Note Title#Section" */
  onOpenSource: (ref: string) => void
}

const KINDS: { kind: ActionKind; label: string; empty?: string; add: string }[] = [
  { kind: 'todo', label: 'To do', empty: 'Nothing open. Absorb a meeting and what it commits you to lands here.', add: 'Add a to-do' },
  { kind: 'change', label: 'Project changes', add: 'Add a change to a project' },
  { kind: 'share', label: 'To share', add: 'Add something to share' }
]

const sourceLabel = (ref: string) => ref.replace('#', ' › ')
const errText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')

/** An input that appears in place of its "+ Add" button and goes away after Enter or Esc. */
function AddRow({ label, className, onAdd }: { label: string; className: string; onAdd: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) ref.current?.focus() }, [open])
  if (!open) return <button className={`${className} act-add-btn`} onClick={() => setOpen(true)}><Plus /> {label}</button>
  return (
    <input
      ref={ref}
      className={`${className} act-add-input`}
      placeholder={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (!draft.trim()) setOpen(false) }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && draft.trim()) { onAdd(draft.trim()); setDraft('') }
        else if (e.key === 'Escape') { e.stopPropagation(); setDraft(''); setOpen(false) }
      }}
    />
  )
}

/**
 * Act, the step after capture and synthesis: the lessons you are practicing, then what you are acting on.
 * Everything lives in one markdown note; actions are filed from the sections you absorb.
 */
export function ActionsView({ onOpenNote, onOpenSource }: Props) {
  const [state, setState] = useState<ActionsState | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => { window.notes.actions().then(setState).catch((e) => setError(errText(e))) }, [])
  useEffect(load, [load])
  useEffect(() => window.notes.onNotesChanged(load), [load])

  const edit = async (e: ActionsEdit) => {
    setError(null)
    try { setState(await window.notes.editActions(e)) } catch (err) { setError(errText(err)) }
  }
  const add = (list: ActionList) => (text: string) => edit({ op: 'add', list, text })
  const rebuild = async () => {
    if (!confirm('Extract actions from every absorbed note again? Open actions that came from a note are replaced. Done ones and ones you added yourself stay.')) return
    setRebuilding(true)
    await edit({ op: 'rebuild' })
    setRebuilding(false)
  }

  const items = state?.items ?? []
  const done = items.filter((i) => i.done)

  const Row = ({ item }: { item: ActionItem }) => (
    <div className={`act-row ${item.done ? 'done' : ''}`}>
      <button className="act-check" onClick={() => edit({ op: 'toggle', text: item.text })} title={item.done ? 'Mark not done' : 'Mark done'}>
        {item.done ? <CircleCheck /> : <Circle />}
      </button>
      <span className="act-text">{item.text}</span>
      {item.source && <button className="act-from" onClick={() => onOpenSource(item.source!)} title={`From ${sourceLabel(item.source)}`}>{item.source.split('#')[0]}</button>}
      <button className="icon-btn small act-remove" onClick={() => edit({ op: 'remove', list: item.kind, text: item.text })} title="Remove"><X /></button>
    </div>
  )

  return (
    <div className="view">
      <div className="view-inner">
        <div className="act-head">
          <h1 className="view-title">Actions</h1>
          <button className="chip ghost" onClick={rebuild} disabled={rebuilding} title="Extract actions from every absorbed note again">
            <RefreshCw className={rebuilding ? 'spin' : ''} /> {rebuilding ? 'Extracting…' : 'Re-extract'}
          </button>
          {state && <button className="chip ghost" onClick={() => onOpenNote(state.noteId)} title="Edit the Actions note as markdown"><Pencil /> Edit as note</button>}
        </div>
        {error && <div className="msg ai err">{error}</div>}

        <section className="act-section">
          <div className="act-label">
            <h2>Practicing</h2>
            {state && state.practices.length > 0 && <CopyButton className="icon-btn small" title="Copy as a list" text={() => state.practices.map((p) => `- ${p}`).join('\n')} />}
          </div>
          <div className="practice-grid">
            {state?.practices.map((p) => (
              <div key={p} className="practice">
                <span>{p}</span>
                <button className="icon-btn small act-remove" onClick={() => edit({ op: 'remove', list: 'practices', text: p })} title="Remove"><X /></button>
              </div>
            ))}
            <AddRow className="practice add" label={state?.practices.length ? 'Add a lesson' : 'A lesson for next time'} onAdd={add('practices')} />
          </div>
        </section>

        {KINDS.map(({ kind, label, empty, add: addLabel }) => {
          const open = items.filter((i) => i.kind === kind && !i.done)
          if (kind !== 'todo' && open.length === 0) return null
          return (
            <section key={kind} className="act-section">
              <div className="act-label">
                <h2>{label}{open.length > 0 && <span className="act-n">{open.length}</span>}</h2>
                {open.length > 0 && <CopyButton className="icon-btn small" title="Copy as a list" text={() => open.map((i) => `- [ ] ${i.text}`).join('\n')} />}
              </div>
              {open.length === 0 && empty && <p className="hint act-empty">{empty}</p>}
              {open.map((i) => <Row key={i.text} item={i} />)}
              <AddRow className="act-row add" label={addLabel} onAdd={add(kind)} />
            </section>
          )
        })}

        {done.length > 0 && (
          <div className="act-done">
            <div className="act-done-head">
              <button className="link" onClick={() => setShowDone((v) => !v)}>{showDone ? 'Hide' : 'Show'} {done.length} done</button>
              {showDone && <button className="link" onClick={() => edit({ op: 'clear-done' })}>Clear done</button>}
            </div>
            {showDone && done.map((i) => <Row key={i.text} item={i} />)}
          </div>
        )}
      </div>
    </div>
  )
}
