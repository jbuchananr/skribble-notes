import { useEffect, useRef, useState } from 'react'
import type { AiStatus, AskSource, AskTurn } from '../../../shared/types'
import { mdToHtml } from '../../../core/markdown'
import { ArrowUp, MessageSquareText, RefreshCw } from './Icons'

interface Entry { id: number; role: 'user' | 'assistant'; text: string; sources?: AskSource[]; error?: boolean }
interface Props { onOpen: (noteId: string, section?: string) => void; reviewedCount: number }

let nextId = 1

/** Chat over reviewed sections and insight cards. Lives on the Reviewed view, not in the editor. */
export function Ask({ onOpen, reviewedCount }: Props) {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => { window.notes.aiStatus().then(setStatus) }, [])
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
    } finally { setBusy(false) }
  }

  if (status && !status.configured) {
    return (
      <div className="ask">
        <p className="hint">Chat over your reviewed notes needs an OpenRouter API key. It stays in <code>~/.config/skribble/ai.json</code> on this Mac.</p>
        <div className="ask-key">
          <input className="text-input" type="password" placeholder="sk-or-v1-…" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} />
          <button className="primary" disabled={!keyDraft.trim()} onClick={async () => setStatus(await window.notes.aiConfigure({ apiKey: keyDraft }))}>Save key</button>
        </div>
      </div>
    )
  }

  return (
    <div className="ask">
      {entries.length > 0 && (
        <div className="thread ask-thread" ref={threadRef}>
          {entries.map((e) => e.role === 'user' ? (
            <div key={e.id} className="msg user">{e.text}</div>
          ) : (
            <div key={e.id} className={`msg ai ${e.error ? 'err' : ''}`}>
              {e.error ? <div>{e.text}</div> : <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(e.text) }} />}
              {e.sources && e.sources.length > 0 && (
                <div className="ask-sources">
                  {e.sources.map((s, i) => <button key={s.nodeId} className="ask-source" onClick={() => onOpen(s.noteId, s.label.split(' › ')[1])}><span className="n">{i + 1}</span>{s.label}</button>)}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="msg ai thinking"><span /><span /><span /></div>}
        </div>
      )}
      <div className="refine-input ask-input">
        <MessageSquareText />
        <textarea
          rows={1}
          placeholder={reviewedCount ? `Ask your ${reviewedCount} reviewed section${reviewedCount === 1 ? '' : 's'}… (what did I decide about onboarding? what keeps coming up?)` : 'Nothing reviewed yet. File a section and it becomes askable here.'}
          value={input}
          disabled={busy || !reviewedCount}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        {entries.length > 0 && <button className="mini" title="Start over" onClick={() => setEntries([])}><RefreshCw /></button>}
        <button className="mini accent" disabled={busy || !input.trim()} onClick={send} title="Send (Enter)"><ArrowUp /></button>
      </div>
    </div>
  )
}
