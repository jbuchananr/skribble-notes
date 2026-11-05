import { useEffect, useRef, useState } from 'react'
import type { AiStatus, GraphNode, Note, Suggestion } from '../../../shared/types'
import { htmlToMd, mdToHtml } from '../../../core/markdown'
import { unitMarkdown } from '../../../core/sections'
import { getAbsorbed } from '../../../core/absorb'
import { label } from '../../../core/inbox'
import { ArrowLeft, ChevronLeft, ChevronRight, Check, Link2, Hash, Lightbulb, Pencil, Sparkles, CornerDownLeft, Brain } from './Icons'

interface Props {
  note: Note
  node: GraphNode
  graph: GraphNode[]
  /** position in the inbox, for "3 of 7" and prev/next */
  position?: { index: number; total: number }
  onBack: () => void
  onEdit: () => void
  onNav: (delta: 1 | -1) => void
  /** called after a successful absorb; the parent decides where to go next */
  onAbsorbed: () => void
}

const fmt = (iso: string) => { const t = Date.parse(iso + 'T12:00:00'); return Number.isNaN(t) ? iso : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }

/**
 * The absorb screen: one unit at a time. Left, what you wrote. Right, the takeaway you type, the
 * connections you keep, and one button. Nothing here edits the note body.
 */
export function Absorb({ note, node, graph, position, onBack, onEdit, onNav, onAbsorbed }: Props) {
  const section = node.section
  const already = getAbsorbed(note.absorbed, section)
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [kept, setKept] = useState<Set<string>>(() => new Set(already?.links ?? []))
  const [tags, setTags] = useState<Set<string>>(() => new Set(already?.tags ?? []))
  const [insight, setInsight] = useState('')
  const [busy, setBusy] = useState(false)
  const insightRef = useRef<HTMLTextAreaElement>(null)

  const md = unitMarkdown(htmlToMd(note.content), section) ?? ''
  const html = mdToHtml(md)
  const byId = new Map(graph.map((g) => [g.id, g]))
  const existingLinks = node.links.map((l) => byId.get(l)).filter((g): g is GraphNode => !!g)

  useEffect(() => { window.notes.aiStatus().then(setStatus) }, [])
  useEffect(() => { insightRef.current?.focus() }, [node.id])

  // ask for connections as soon as the screen opens, when a key is configured
  useEffect(() => {
    if (!status?.configured) return
    let alive = true
    setSuggesting(true); setSuggestion(null); setError(null)
    window.notes.aiSuggest({ noteId: note.id, section })
      .then((s) => { if (!alive) return; setSuggestion(s); setKept((k) => new Set([...k, ...s.links.map((l) => l.target)])); setTags((t) => new Set([...t, ...s.tags])) })
      .catch((e) => { if (alive) setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')) })
      .finally(() => { if (alive) setSuggesting(false) })
    return () => { alive = false }
  }, [node.id, status?.configured]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (t: string) => setKept((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n })
  const toggleTag = (t: string) => setTags((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n })

  const absorb = async () => {
    if (busy) return
    setBusy(true); setError(null)
    try {
      await window.notes.absorb({ noteId: note.id, section, links: [...kept], tags: [...tags], insight: insight.trim() || undefined })
      onAbsorbed()
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
      setBusy(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); absorb() }
      else if (e.key === 'j' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onNav(1) }
      else if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onNav(-1) }
      else if (e.key === 'Escape') { e.preventDefault(); onBack() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  // connections to show: suggested ones first, then links already in the text or a previous absorb
  const suggested = suggestion?.links ?? []
  const extra = existingLinks.filter((g) => !suggested.some((s) => s.label === label(g))).map((g) => ({ target: g.section ? `${g.noteTitle}#${g.section}` : g.noteTitle, label: label(g), why: '' }))
  const connections = [...suggested, ...extra]

  return (
    <div className="absorb">
      <div className="absorb-top">
        <button className="back" onClick={onBack} title="Back (Esc)"><ArrowLeft /> Notes</button>
        {position && (
          <div className="absorb-nav">
            <button className="mini" onClick={() => onNav(-1)} disabled={position.index <= 0} title="Previous (⌘K)"><ChevronLeft /></button>
            <span>{position.index + 1} of {position.total}</span>
            <button className="mini" onClick={() => onNav(1)} disabled={position.index >= position.total - 1} title="Next (⌘J)"><ChevronRight /></button>
          </div>
        )}
        <button className="chip ghost" onClick={onEdit} title="Open the note in the editor"><Pencil /> Edit note</button>
      </div>

      <div className="absorb-body">
        <div className="absorb-read">
          <div className="absorb-crumb">{note.title || 'Untitled'}{node.date && <span className="source-meta"> · {fmt(node.date)}</span>}</div>
          {section && <h2 className="absorb-heading">{section}</h2>}
          {already && <div className="absorb-already"><Brain /> Absorbed {fmt(already.date)}. Absorbing again replaces that entry.</div>}
          <div className="absorb-text ProseMirror" dangerouslySetInnerHTML={{ __html: html || '<p class="hint">Nothing written here yet.</p>' }} />
        </div>

        <div className="absorb-side">
          <section className="absorb-block">
            <h3><Lightbulb /> Takeaway, in your own words</h3>
            <textarea ref={insightRef} rows={3} className="text-input absorb-insight" placeholder="One sentence. Leave empty if this one has no takeaway." value={insight} onChange={(e) => setInsight(e.target.value)} />
            {suggestion?.insightQuote && <div className="absorb-quote">You wrote: “{suggestion.insightQuote}”</div>}
          </section>

          <section className="absorb-block">
            <h3><Link2 /> Connections {suggesting && <span className="absorb-spin" />}</h3>
            {status && !status.configured && (
              <div className="ask-key-block">
                <p className="hint">Suggestions need a Gemini (AI Studio) or OpenRouter key. It stays in <code>~/.config/skribble/ai.json</code>.</p>
                <div className="ask-key">
                  <input className="text-input" type="password" placeholder="AIza… or sk-or-v1-…" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} />
                  <button className="primary" disabled={!keyDraft.trim()} onClick={async () => setStatus(await window.notes.aiConfigure({ apiKey: keyDraft }))}>Save</button>
                </div>
              </div>
            )}
            {error && <div className="msg ai err">{error}</div>}
            {!suggesting && status?.configured && connections.length === 0 && !error && <p className="hint">Nothing in your other notes clearly connects to this yet.</p>}
            <div className="absorb-conns">
              {connections.map((c) => (
                <button key={c.target} className={`absorb-conn ${kept.has(c.target) ? 'on' : ''}`} onClick={() => toggle(c.target)} title={kept.has(c.target) ? 'Keep this link' : 'Not linked'}>
                  <span className="absorb-conn-check"><Check /></span>
                  <span className="absorb-conn-body">
                    <span className="absorb-conn-label">{c.label}</span>
                    {c.why && <span className="absorb-conn-why">{c.why}</span>}
                  </span>
                </button>
              ))}
            </div>
            {(tags.size > 0 || (suggestion?.tags.length ?? 0) > 0) && (
              <div className="absorb-tags">
                <Hash />
                {[...new Set([...tags, ...(suggestion?.tags ?? [])])].map((t) => <button key={t} className={`chip ${tags.has(t) ? 'on' : 'ghost'}`} onClick={() => toggleTag(t)}>#{t}</button>)}
              </div>
            )}
          </section>

          <div className="absorb-actions">
            <button className="btn-primary absorb-btn" disabled={busy} onClick={absorb}>
              <Brain /> {already ? 'Absorb again' : 'Absorb'} <kbd><CornerDownLeft /></kbd>
            </button>
            <span className="hint">⌘↩ absorbs · ⌘J next · ⌘K previous</span>
          </div>
          {suggestion && suggestion.context.length > 0 && <div className="comment-ctx">Compared with: {suggestion.context.join(' · ')}</div>}
          {!status?.configured && <span className="hint"><Sparkles /> Absorbing works without a key; you just won't get suggested connections.</span>}
        </div>
      </div>
    </div>
  )
}
