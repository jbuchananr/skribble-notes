import { useEffect, useState } from 'react'
import type { GraphNode, Note } from '../../../shared/types'
import { isReviewUnit } from '../../../core/review'
import { X, Hash, Link2, ListTree, CheckCheck } from './Icons'
import { FileSection } from './FileSection'
import type { EditorOps } from './editor-ops'

export type PanelTab = 'file' | 'context'

interface Props {
  note: Note
  graph: GraphNode[]
  ops: EditorOps
  onOpenNote: (id: string) => void
  onClose: () => void
  tab: PanelTab
  setTab: (t: PanelTab) => void
  fileSection?: string
}

const label = (n: GraphNode) => (n.section ? `${n.noteTitle || 'Untitled'} › ${n.section}` : n.noteTitle || 'Untitled')

export function ContextPanel({ note, graph, ops, onOpenNote, onClose, tab, setTab, fileSection }: Props) {
  const [headings, setHeadings] = useState<{ text: string; level: number; el: HTMLElement }[]>([])

  const mine = graph.filter((g) => g.noteId === note.id)
  const byId = new Map(graph.map((g) => [g.id, g]))
  const links = [...new Set(mine.flatMap((m) => m.links))].map((l) => byId.get(l)!).filter(Boolean)
  const backlinks = [...new Set(mine.flatMap((m) => m.backlinks))].map((l) => byId.get(l)!).filter(Boolean)
  const tags = [...new Set(mine.flatMap((m) => m.tags))]
  const pendingHere = mine.filter((g) => !g.reviewed && isReviewUnit(g, graph)).length

  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>(".ProseMirror h1, .ProseMirror h2")]
    setHeadings(els.map((el) => ({ text: el.textContent ?? '', level: el.tagName === 'H1' ? 1 : 2, el })))
  }, [note.id, note.content])

  return (
    <aside className={`context ${tab === 'file' ? 'refine-mode' : ''}`}>
      <div className="context-head">
        <div className="ctx-tabs">
          <button className={tab === 'file' ? 'on' : ''} onClick={() => setTab('file')}><CheckCheck /> File{pendingHere > 0 && <span className="tab-n">{pendingHere}</span>}</button>
          <button className={tab === 'context' ? 'on' : ''} onClick={() => setTab('context')}><Link2 /> Context</button>
        </div>
        <button className="mini" onClick={onClose} title="Close (Esc)"><X /></button>
      </div>
      {tab === 'file' ? <FileSection note={note} graph={graph} ops={ops} initialSection={fileSection} /> : <>

      {headings.length > 1 && (
        <section>
          <h3><ListTree /> Outline</h3>
          <div className="outline">
            {headings.map((h, i) => {
              const node = mine.find((g) => g.section === h.text.trim())
              return (
                <button key={i} className={`outline-row l${h.level}`} onClick={() => h.el.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                  {h.text || 'Untitled'}{node?.reviewed && <CheckCheck className="outline-ok" />}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {(links.length > 0 || backlinks.length > 0) && (
        <section>
          <h3><Link2 /> Linked</h3>
          {links.map((l) => <button key={l.id} className="note-link" onClick={() => onOpenNote(l.noteId)}>{label(l)} <span className="source-meta">→</span></button>)}
          {backlinks.map((l) => <button key={l.id} className="note-link" onClick={() => onOpenNote(l.noteId)}><span className="source-meta">←</span> {label(l)}</button>)}
        </section>
      )}

      {tags.length > 0 && (
        <section>
          <h3><Hash /> Tags</h3>
          <div className="tags">{tags.map((t) => <span key={t} className="tag">#{t}</span>)}</div>
        </section>
      )}

      <p className="hint">Link with <code>[[Note]]</code> or <code>[[Note#Section]]</code>, tag with <code>#tag</code>. Filing a section adds a <code>Links:</code> and a <code>Reviewed:</code> line to it; your text is never edited.</p>
      </>}
    </aside>
  )
}
