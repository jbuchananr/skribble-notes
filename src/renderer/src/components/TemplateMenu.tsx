import { useEffect, useRef, useState } from 'react'
import type { Template } from '../../../shared/types'
import { LayoutTemplate, Plus, Trash2 } from './Icons'

interface Props {
  onInsert: (t: Template) => void
  /** current note body as markdown, for "save as template" */
  currentMarkdown: () => string
  currentTitle: string
}

export function TemplateMenu({ onInsert, currentMarkdown, currentTitle }: Props) {
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const ref = useRef<HTMLDivElement>(null)

  const load = () => window.notes.listTemplates().then(setTemplates)
  useEffect(() => { if (open) load() }, [open])
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const saveCurrent = async () => {
    const name = prompt('Template name', currentTitle || 'My template')
    if (!name) return
    await window.notes.saveTemplate({ name, body: currentMarkdown() })
    await load()
  }

  return (
    <div className="tmenu" ref={ref}>
      <button className={`icon-btn ${open ? 'on' : ''}`} onClick={() => setOpen((v) => !v)} title="Insert template  (⇧⌘M meeting, ⇧⌘R reflection)"><LayoutTemplate /></button>
      {open && (
        <div className="menu">
          <div className="menu-label">Insert at cursor</div>
          {templates.map((t) => (
            <div key={t.name} className="menu-row">
              <button className="menu-item" onClick={() => { onInsert(t); setOpen(false) }}>{t.name}</button>
              {!['Meeting', 'Reflection'].includes(t.name) && (
                <button className="mini" title="Delete template" onClick={async () => { if (confirm(`Delete template "${t.name}"?`)) { await window.notes.deleteTemplate(t.name); load() } }}><Trash2 /></button>
              )}
            </div>
          ))}
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => { saveCurrent(); setOpen(false) }}><Plus /> Save this note as a template</button>
          <div className="menu-hint">Templates are markdown files in ~/Notes/.templates. <code>{'{{date}}'}</code> becomes today.</div>
        </div>
      )}
    </div>
  )
}
