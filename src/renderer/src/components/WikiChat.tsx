import { useEffect, useRef, useState } from 'react'
import type { AiStatus, AskSource, AskTurn, WikiStatus } from '../../../shared/types'
import { mdToHtml } from '../../../core/markdown'
import { ArrowUp, BookOpen, RefreshCw } from './Icons'

interface Entry { id: number; role: 'user' | 'assistant'; text: string; sources?: AskSource[]; error?: boolean }
interface Props {
  pageCount: number
  onOpen: (noteId: string, section?: string) => void
  onOpenPage: (slug: string) => void
  onSettings: () => void
}

let nextId = 1

/** The wiki as a conversation: ask, get an answer from your pages and absorbed notes, follow the citations. */
export function WikiChat({ pageCount, onOpen, onOpenPage, onSettings }: Props) {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [wiki, setWiki] = useState<WikiStatus | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const refresh = () => { window.notes.aiStatus().then(setStatus); window.notes.wikiStatus().then(setWiki) }
  useEffect(() => { refresh(); inputRef.current?.focus() }, [])
  useEffect(() => window.notes.onWikiChanged(refresh), [])
  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }) }, [entries.length, busy])

  const send = async () => {
    const q = input.trim()
    if (!q || busy) return
    const history: AskTurn[] = entries.filter((e) => !e.error).map((e) => ({ role: e.role, content: e.text }))
    setEntries((s) => [...s, { id: nextId++, role: 'user', text: q }])
    setInput(''); setBusy(true)
    try {
      const res = await window.notes.aiAsk({ question: q, history })
      setEntries((s) => [...s, { id: nextId++, role: 'assistant', text: res.reply, sources: res.sources }])
    } catch (e) {
      setEntries((s) => [...s, { id: nextId++, role: 'assistant', text: (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''), error: true }])
    } finally { setBusy(false); inputRef.current?.focus() }
  }

  const ready = !!status?.configured

  return (
    <div className="wiki-chat">
      <div className="thread wiki-thread" ref={threadRef}>
        {entries.length === 0 && (
          <div className="wiki-intro">
            <BookOpen />
            <h1>Wiki</h1>
            <p>{pageCount ? `${pageCount} page${pageCount === 1 ? '' : 's'} built from what you absorbed. Ask it anything; answers cite the page or the note section they came from.` : 'Nothing here yet. Absorb a note and the first pages appear.'}</p>
            {wiki?.busy && <div className="wiki-status inline"><RefreshCw className="spin" /> Updating the wiki…</div>}
            {!wiki?.busy && wiki && wiki.pending > 0 && <div className="wiki-status inline"><RefreshCw /> {wiki.pending} absorbed section{wiki.pending === 1 ? '' : 's'} not in the wiki yet. {ready ? <button className="link" onClick={() => window.notes.wikiRebuild(false)}>Update now</button> : <button className="link" onClick={onSettings}>Add a key</button>}</div>}
            {wiki?.lastError && <div className="msg ai err">Last wiki update failed: {wiki.lastError}</div>}
            {!ready && status && <p className="hint">Chat and the wiki itself need an API key. <button className="link" onClick={onSettings}>Open Settings</button></p>}
          </div>
        )}
        {entries.map((e) => e.role === 'user' ? (
          <div key={e.id} className="msg user">{e.text}</div>
        ) : (
          <div key={e.id} className={`msg ai ${e.error ? 'err' : ''}`}>
            {e.error ? <div>{e.text}</div> : <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(e.text) }} />}
            {e.sources && e.sources.length > 0 && (
              <div className="ask-sources">
                {e.sources.map((s, i) => <button key={s.nodeId} className="ask-source" onClick={() => (s.page ? onOpenPage(s.page) : s.noteId && onOpen(s.noteId, s.section))}><span className="n">{i + 1}</span>{s.label}</button>)}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="msg ai thinking"><span /><span /><span /></div>}
      </div>
      <div className="wiki-input-wrap">
        <div className="refine-input wiki-input">
          <textarea
            ref={inputRef}
            rows={1}
            placeholder={ready ? 'Ask the wiki…' : 'Add an API key in Settings to chat'}
            value={input}
            disabled={busy || !ready}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          />
          {entries.length > 0 && <button className="mini" title="Start over" onClick={() => setEntries([])}><RefreshCw /></button>}
          <button className="mini accent" disabled={busy || !input.trim() || !ready} onClick={send} title="Send (Enter)"><ArrowUp /></button>
        </div>
      </div>
    </div>
  )
}
