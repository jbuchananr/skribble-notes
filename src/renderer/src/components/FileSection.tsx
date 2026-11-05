import { useEffect, useMemo, useState } from 'react'
import type { AiStatus, FileResult, GraphNode, Note } from '../../../shared/types'
import { applyFiling, existingLinks, today } from '../../../core/filing'
import { isReviewUnit } from '../../../core/review'
import { Check, Link2, Sparkles, X, Hash, Lightbulb, ChevronRight } from './Icons'
import type { EditorOps } from './editor-ops'

interface Props {
  note: Note
  graph: GraphNode[]
  ops: EditorOps
  /** section to start on (from the review pile) */
  initialSection?: string
}

/**
 * File a section: the agent proposes links and tags, you keep what fits, type the takeaway in your own
 * words if there is one, and mark the section reviewed. Your text is never edited; two lines are
 * appended to the section.
 */
export function FileSection({ note, graph, ops, initialSection }: Props) {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [section, setSection] = useState<string | undefined>(() => initialSection ?? ops.currentSection())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<FileResult | null>(null)
  const [kept, setKept] = useState<Set<string>>(new Set())
  const [keptTags, setKeptTags] = useState<Set<string>>(new Set())
  const [insight, setInsight] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const [keyDraft, setKeyDraft] = useState('')

  useEffect(() => { window.notes.aiStatus().then(setStatus) }, [])
  useEffect(() => { if (initialSection) { setSection(initialSection); ops.scrollToSection(initialSection) } }, [initialSection]) // eslint-disable-line react-hooks/exhaustive-deps

  const sections = ops.sections()
  const hasSections = sections.length > 0
  const mine = graph.filter((g) => g.noteId === note.id)
  const units = mine.filter((g) => isReviewUnit(g, graph))
  const current = section ? mine.find((g) => g.section === section) : mine.find((g) => g.level === 0)
  const pending = units.filter((u) => !u.reviewed)
  const unitLabel = section ?? (hasSections ? 'Pick a section' : 'Whole note')

  // reset when the user changes section
  useEffect(() => { setProposal(null); setError(null); setDone(null); setInsight(''); setKept(new Set()); setKeptTags(new Set()) }, [section])

  const already = useMemo(() => existingLinks(ops.markdown(), section), [section, note.content]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (h: string | undefined) => { setSection(h); if (h) ops.scrollToSection(h) }

  const suggest = async () => {
    if (busy || (hasSections && !section)) return
    setBusy(true); setError(null); setDone(null)
    try {
      const res = await window.notes.aiFile({ noteId: note.id, title: note.title, body: ops.markdown(), section })
      setProposal(res)
      setKept(new Set([...already, ...res.links.map((l) => l.target)]))
      setKeptTags(new Set(res.tags))
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    } finally { setBusy(false) }
  }

  const toggle = (t: string) => setKept((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n })
  const toggleTag = (t: string) => setKeptTags((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n })

  const markReviewed = async () => {
    if (busy || (hasSections && !section)) return
    setBusy(true); setError(null)
    try {
      const text = insight.trim()
      if (text) await window.notes.insightAdd({ text, noteTitle: note.title || 'Untitled', section })
      const links = proposal ? [...kept] : already
      const tags = proposal ? [...keptTags] : []
      const next = applyFiling(ops.markdown(), section, { links, tags, reviewed: today() })
      if (next === null) throw new Error('Could not find that section in the note anymore')
      ops.replaceMarkdown(next)
      setDone(text ? 'Reviewed. Insight filed.' : 'Reviewed.')
      setProposal(null); setInsight('')
      // move on to the next unreviewed section in this note
      const rest = pending.filter((u) => u.section !== section && u.section)
      if (rest.length) setTimeout(() => pick(rest[0].section), 900)
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    } finally { setBusy(false) }
  }

  return (
    <div className="refine file">
      <div className="refine-scope">
        <Link2 />
        {hasSections ? (
          <select value={section ?? ''} onChange={(e) => pick(e.target.value || undefined)} title="Section to file">
            <option value="">Pick a section…</option>
            {sections.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        ) : <span className="file-scope-label">{unitLabel}</span>}
        {current?.reviewed && <span className="file-reviewed" title={`Reviewed ${current.reviewed}`}><Check /> {current.reviewed.slice(5).replace('-', '/')}</span>}
      </div>

      <div className="thread">
        {pending.length > 0 && (
          <div className="file-queue">
            <div className="file-queue-head">{pending.length} to review in this note</div>
            {pending.slice(0, 6).map((u) => (
              <button key={u.id} className={`file-queue-row ${u.section === section || (!u.section && !section) ? 'on' : ''}`} onClick={() => pick(u.section)}>
                <ChevronRight /> <span>{u.section ?? 'Whole note'}</span>
              </button>
            ))}
            {pending.length > 6 && <div className="hint">…and {pending.length - 6} more</div>}
          </div>
        )}
        {pending.length === 0 && units.length > 0 && !done && (
          <div className="refine-empty"><Check /><p>Everything in this note is reviewed.</p></div>
        )}

        {already.length > 0 && !proposal && (
          <div className="file-already"><span className="hint">Filed links:</span> {already.map((l) => <span key={l} className="tag">[[{l}]]</span>)}</div>
        )}

        {error && <div className="msg ai err">{error}</div>}
        {done && <div className="comment-state"><Check /> {done}</div>}

        {proposal && (
          <div className="file-proposal">
            {proposal.links.length === 0 && <p className="hint">Nothing in your other notes clearly connects to this. Mark it reviewed, or link it by hand with <code>[[Note#Section]]</code>.</p>}
            {proposal.links.map((l) => (
              <label key={l.target} className={`comment file-link ${kept.has(l.target) ? 'applied' : 'dismissed'}`}>
                <input type="checkbox" checked={kept.has(l.target)} onChange={() => toggle(l.target)} />
                <div>
                  <div className="comment-head"><span className="comment-kind connect">Link</span><span className="comment-link"><Link2 />{l.label}</span></div>
                  {l.why && <div className="comment-note">{l.why}</div>}
                </div>
              </label>
            ))}
            {proposal.tags.length > 0 && (
              <div className="file-tags">
                <Hash />
                {proposal.tags.map((t) => <button key={t} className={`chip ${keptTags.has(t) ? 'on' : 'ghost'}`} onClick={() => toggleTag(t)}>#{t}</button>)}
              </div>
            )}
            {proposal.context.length > 0 && <div className="comment-ctx">Compared with: {proposal.context.join(' · ')}</div>}
          </div>
        )}

        {(proposal || !hasSections || section) && !done && (
          <div className="file-insight">
            <div className="file-insight-head"><Lightbulb /> Takeaway, in your own words <span className="hint">(optional)</span></div>
            <textarea rows={2} className="text-input" placeholder="One sentence. It goes to your Insights note with a link back here." value={insight} onChange={(e) => setInsight(e.target.value)} />
            {proposal?.insightQuote && (
              <button className="comment-quote file-quote" onClick={() => ops.highlight(proposal.insightQuote!)} title="Show in note. Type your version above; nothing is inserted.">
                You wrote: “{proposal.insightQuote}”
              </button>
            )}
          </div>
        )}
      </div>

      {status && !status.configured && (
        <div className="file-key">
          <p className="hint">Link suggestions need a Gemini (AI Studio) or OpenRouter key, kept in <code>~/.config/skribble/ai.json</code>. Marking reviewed works without one.</p>
          <div className="ask-key">
            <input className="text-input" type="password" placeholder="AIza… or sk-or-v1-…" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} />
            <button className="primary" disabled={!keyDraft.trim()} onClick={async () => setStatus(await window.notes.aiConfigure({ apiKey: keyDraft }))}>Save</button>
          </div>
        </div>
      )}
      <div className="chips file-actions">
        <button className="chip" disabled={busy || (hasSections && !section) || !status?.configured} onClick={suggest} title="Ask where this connects in your other notes"><Sparkles /> {proposal ? 'Suggest again' : 'Suggest links'}</button>
        <button className="chip accent" disabled={busy || (hasSections && !section)} onClick={markReviewed} title="Append Links and Reviewed lines to this section"><Check /> Mark reviewed</button>
        {proposal && <button className="chip ghost" disabled={busy} onClick={() => setProposal(null)}><X /> Discard</button>}
      </div>
      {busy && <div className="msg ai thinking"><span /><span /><span /></div>}
    </div>
  )
}
