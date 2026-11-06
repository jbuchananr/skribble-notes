import { useEffect, useState } from 'react'
import type { AiStatus, WikiStatus, CloudStatus } from '../../../shared/types'
import { BookOpen, Cloud, RefreshCw, Check, Pencil } from './Icons'
import { autocorrectEnabled, setAutocorrectEnabled } from '@/lib/autocorrect'

/** API key, model, wiki status. Everything else is in the files. */
export function Settings() {
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [key, setKey] = useState('')
  const [model, setModel] = useState('')
  const [saved, setSaved] = useState(false)
  const [wiki, setWiki] = useState<WikiStatus | null>(null)
  const [dir, setDir] = useState('')
  const [log, setLog] = useState('')
  const [autocorrect, setAutocorrect] = useState(autocorrectEnabled)
  const [cloud, setCloud] = useState<CloudStatus | null>(null)
  const [dbUrl, setDbUrl] = useState('')
  const [cloudError, setCloudError] = useState('')
  const [cloudSaved, setCloudSaved] = useState(false)

  const refresh = () => { window.notes.aiStatus().then((s) => { setAi(s); setModel((m) => m || s.model || '') }); window.notes.wikiStatus().then(setWiki); window.notes.wikiLog().then(setLog) }
  useEffect(() => { refresh(); window.notes.notesDir().then(setDir) }, [])
  useEffect(() => window.notes.onWikiChanged(refresh), [])
  useEffect(() => { window.notes.cloudStatus().then(setCloud); return window.notes.onCloudChanged(() => window.notes.cloudStatus().then(setCloud)) }, [])

  const saveCloud = async (url: string) => {
    setCloudError('')
    try {
      setCloud(await window.notes.cloudConfigure(url))
      setDbUrl(''); setCloudSaved(true); setTimeout(() => setCloudSaved(false), 1500)
    } catch (e) {
      setCloudError((e as Error).message.replace(/^.*Error: /, ''))
    }
  }
  const ago = (t?: number) => {
    if (!t) return 'never'
    const s = Math.round((Date.now() - t) / 1000)
    return s < 5 ? 'just now' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(t).toLocaleString()
  }

  const save = async () => {
    if (!key.trim() && !ai?.configured) return
    // keep the stored key when only the model changed
    const s = await window.notes.aiConfigure(key.trim() ? { apiKey: key.trim(), model: model.trim() || undefined } : { apiKey: '__keep__', model: model.trim() || undefined })
    setAi(s); setKey(''); setSaved(true); setTimeout(() => setSaved(false), 1500)
  }

  const provider = key.trim().startsWith('AIza') ? 'Gemini (AI Studio)' : key.trim() ? 'OpenRouter' : ai?.model?.includes('/') ? 'OpenRouter' : ai?.configured ? 'Gemini (AI Studio)' : null

  return (
    <div className="view">
      <div className="view-inner settings">
        <h1 className="view-title">Settings</h1>

        <section>
          <h3>Model</h3>
          <p className="hint">Powers the wiki, suggested connections and chat. Paste an OpenRouter key (<code>sk-or-v1-…</code>) or a Gemini key from Google AI Studio (<code>AIza…</code>). It stays in <code>~/.config/skribble/ai.json</code>.</p>
          <input className="text-input" type="password" placeholder={ai?.configured ? 'Key saved · paste a new one to replace it' : 'sk-or-v1-… or AIza…'} value={key} onChange={(e) => setKey(e.target.value)} />
          <label className="settings-row"><span>Model</span><input className="text-input" placeholder={key.trim().startsWith('AIza') ? 'gemini-3.8-flash' : 'google/gemini-3.8-flash'} value={model} onChange={(e) => setModel(e.target.value)} /></label>
          <div className="settings-actions">
            <button className="btn-primary" disabled={!key.trim() && !ai?.configured} onClick={save}>{saved ? <><Check /> Saved</> : 'Save'}</button>
            <span className="hint">{ai?.configured ? `Configured · ${provider ?? ''} · ${ai.model}` : 'No key yet. Absorbing works without one; the wiki and chat need it.'}</span>
          </div>
        </section>

        <section>
          <h3><Pencil /> Writing</h3>
          <label className="settings-check">
            <input type="checkbox" checked={autocorrect} onChange={(e) => { setAutocorrectEnabled(e.target.checked); setAutocorrect(e.target.checked) }} />
            <span>Autocorrect spelling as you type</span>
          </label>
          <p className="hint">A misspelled word is fixed when you finish it. Backspace right after puts back what you typed. Names, acronyms and words you already use in your notes are left alone. Right-click a word underlined in red for suggestions or Learn Spelling.</p>
        </section>

        <section>
          <h3><Cloud /> Cloud sync</h3>
          <p className="hint">Keeps this folder the same on every Mac you use: notes, the wiki, templates. Paste the Postgres connection string from your Neon project; it stays in <code>~/.config/skribble/cloud.json</code>. Use the same string on each machine.</p>
          <input className="text-input" type="password" placeholder={cloud?.configured ? 'Connected · paste a new string to switch databases' : 'postgresql://user:password@host/db?sslmode=require'} value={dbUrl} onChange={(e) => setDbUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && dbUrl.trim()) saveCloud(dbUrl) }} />
          <div className="settings-actions">
            <button className="btn-primary" disabled={!dbUrl.trim() || cloud?.busy} onClick={() => saveCloud(dbUrl)}>{cloudSaved ? <><Check /> Connected</> : 'Connect'}</button>
            {cloud?.configured && <button className="chip" disabled={cloud.busy} onClick={() => window.notes.cloudSync().then(setCloud)}><RefreshCw className={cloud.busy ? 'spin' : ''} /> {cloud.busy ? 'Syncing…' : 'Sync now'}</button>}
            {cloud?.configured && <button className="chip ghost" disabled={cloud.busy} onClick={() => { if (confirm('Disconnect from the cloud database? Files on this Mac stay as they are.')) saveCloud('') }}>Disconnect</button>}
            <span className="hint">{cloud?.configured ? `This Mac is ${cloud.device} · last sync ${ago(cloud.lastSync)}${cloud.last ? ` · ↓${cloud.last.pulled} ↑${cloud.last.pushed}${cloud.last.conflicts ? ` · ${cloud.last.conflicts} conflict(s) kept in .conflicts/` : ''}` : ''}` : 'Not connected. Everything stays on this Mac.'}</span>
          </div>
          {(cloudError || cloud?.lastError) && <div className="msg ai err">{cloudError || `Last sync failed: ${cloud?.lastError}`}</div>}
          <p className="hint">Syncs after every save, once a minute, and when the window comes to the front. If the same note changes on both Macs before they sync, the newer version wins and the other is kept under <code>.conflicts/</code> in the notes folder.</p>
        </section>

        <section>
          <h3><BookOpen /> Wiki</h3>
          <p className="hint">Pages the agent maintains from what you absorbed, in <code>{dir}/wiki</code>. Edit <code>wiki/WIKI.md</code> to change how it writes them.</p>
          <div className="settings-actions">
            <button className="chip" disabled={!ai?.configured || wiki?.busy} onClick={() => window.notes.wikiRebuild(false)}><RefreshCw className={wiki?.busy ? 'spin' : ''} /> {wiki?.busy ? 'Updating…' : wiki?.pending ? `Update wiki (${wiki.pending} waiting)` : 'Up to date'}</button>
            <button className="chip ghost" disabled={!ai?.configured || wiki?.busy} onClick={() => { if (confirm('Re-ingest every absorbed section into the wiki? Existing pages are extended, not deleted.')) window.notes.wikiRebuild(true) }}>Rebuild from scratch</button>
          </div>
          {wiki?.lastError && <div className="msg ai err">Last wiki update failed: {wiki.lastError}</div>}
          {log && <pre className="settings-log">{log.trim().split('\n').slice(-12).join('\n')}</pre>}
        </section>
      </div>
    </div>
  )
}
