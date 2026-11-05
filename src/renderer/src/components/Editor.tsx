import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details'
import type { GraphNode, Note, Template } from '../../../shared/types'
import { longDate } from '@/lib/dates'
import { mdToHtml, htmlToMd } from '../../../core/markdown'
import { renderTemplate } from '../../../core/template-render'
import { isReviewUnit } from '../../../core/review'
import { ContextPanel, type PanelTab } from './ContextPanel'
import type { EditorOps } from './editor-ops'
import { TemplateMenu } from './TemplateMenu'
import { Trash2, Pin, PinOff, Bold, Italic, Strikethrough, ListChecks, ArrowLeft, CheckCheck } from './Icons'

/** Apple Notes-style formatting shortcuts. */
const Shortcuts = Extension.create({
  name: 'skribbleShortcuts',
  addKeyboardShortcuts() {
    const fire = (name: string) => { window.dispatchEvent(new CustomEvent(name)); return true }
    return {
      'Mod-Shift-t': () => this.editor.chain().focus().setHeading({ level: 1 }).run(),
      'Mod-Shift-h': () => this.editor.chain().focus().setHeading({ level: 2 }).run(),
      'Mod-Shift-b': () => this.editor.chain().focus().setParagraph().run(),
      'Mod-Shift-l': () => this.editor.chain().focus().toggleTaskList().run(),
      'Mod-Shift-x': () => this.editor.chain().focus().toggleStrike().run(),
      'Mod-Shift-i': () => fire('skribble:toggle-panel'),
      'Mod-Shift-f': () => fire('skribble:file-panel'),
      'Mod-Shift-m': () => fire('skribble:template:Meeting'),
      'Mod-Shift-r': () => fire('skribble:template:Reflection')
    }
  }
})

interface Props {
  note: Note
  saving: boolean
  /** opened from the review pile: scroll here and open the File tab */
  initialSection?: string | null
  onChange: (patch: Partial<Note>) => void
  onDelete: () => void
  onBack: () => void
  graph: GraphNode[]
  onOpenNote: (id: string) => void
}

const SERIALIZE_DELAY = 300

export function Editor({ note, saving, initialSection, onChange, onDelete, onBack, graph, onOpenNote }: Props) {
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const [panel, setPanel] = useState(initialSection != null)
  const [panelTab, setPanelTab] = useState<PanelTab>('file')
  // last HTML we handed to the app; lets us tell our own saves from edits made on disk (MCP write, import)
  const lastHtml = useRef(note.content)
  const serializeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: true, autolink: true } }),
      Shortcuts,
      Placeholder.configure({ placeholder: 'Start writing…' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Details.configure({ persist: false, HTMLAttributes: { class: 'details' } }),
      DetailsSummary,
      DetailsContent
    ],
    content: note.content,
    // Serializing a long note on every keystroke is the expensive part; batch it.
    onUpdate: ({ editor }) => {
      if (serializeTimer.current) clearTimeout(serializeTimer.current)
      serializeTimer.current = setTimeout(() => {
        const html = editor.getHTML()
        lastHtml.current = html
        onChangeRef.current({ content: html })
        serializeTimer.current = null
      }, SERIALIZE_DELAY)
    }
  })

  // flush pending serialization on unmount so the last keystrokes are saved
  useEffect(() => () => {
    if (serializeTimer.current && editor) {
      clearTimeout(serializeTimer.current)
      const html = editor.getHTML()
      if (html !== lastHtml.current) onChangeRef.current({ content: html })
    }
  }, [editor])

  // The note changed on disk (MCP write, import): refresh the editor without losing the caret.
  useEffect(() => {
    if (!editor || note.content === lastHtml.current) return
    if (serializeTimer.current) return // user is mid-edit; their save will win
    const { from } = editor.state.selection
    editor.commands.setContent(note.content, { emitUpdate: false })
    lastHtml.current = note.content
    editor.commands.setTextSelection(Math.min(from, editor.state.doc.content.size))
  }, [note.content, editor])

  useEffect(() => {
    if (!note.title && !note.content) titleRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = el.scrollHeight + 'px'
  }, [note.title])

  const insertTemplate = useCallback(async (t: Template) => {
    if (!editor) return
    const html = mdToHtml(renderTemplate(t.body))
    editor.chain().focus().insertContent(html).run()
    // put the caret on the heading so the name can be typed right away
    const headingPos = (() => {
      let pos = -1
      editor.state.doc.descendants((node, p) => { if (pos < 0 && node.type.name === 'heading' && node.textContent.includes('Meeting name')) pos = p })
      return pos
    })()
    if (headingPos >= 0) editor.commands.setTextSelection({ from: headingPos + 1, to: headingPos + 1 + 'Meeting name'.length })
  }, [editor])

  useEffect(() => {
    const toggle = () => setPanel((v) => !v)
    const file = () => { setPanelTab('file'); setPanel(true) }
    const tpl = (name: string) => async () => {
      const t = (await window.notes.listTemplates()).find((x) => x.name === name)
      if (t) insertTemplate(t)
    }
    const m = tpl('Meeting'); const r = tpl('Reflection')
    window.addEventListener('skribble:toggle-panel', toggle)
    window.addEventListener('skribble:file-panel', file)
    window.addEventListener('skribble:template:Meeting', m)
    window.addEventListener('skribble:template:Reflection', r)
    return () => {
      window.removeEventListener('skribble:toggle-panel', toggle)
      window.removeEventListener('skribble:file-panel', file)
      window.removeEventListener('skribble:template:Meeting', m)
      window.removeEventListener('skribble:template:Reflection', r)
    }
  }, [insertTemplate])

  // ---- what the side panel can do with the editor ----
  const findQuote = (quote: string): { from: number; to: number } | null => {
    if (!editor || !quote) return null
    const needle = quote.trim()
    let hit: { from: number; to: number } | null = null
    editor.state.doc.descendants((node, pos) => {
      if (hit || !node.isTextblock) return
      const i = node.textContent.indexOf(needle)
      if (i >= 0) {
        // map the string offset to a doc position by walking the inline children
        let off = 0; let from = -1; let to = -1
        node.forEach((child, childOffset) => {
          const len = child.isText ? (child.text?.length ?? 0) : child.nodeSize
          if (from < 0 && i < off + len) from = pos + 1 + childOffset + (i - off)
          if (from >= 0 && to < 0 && i + needle.length <= off + len) to = pos + 1 + childOffset + (i + needle.length - off)
          off += len
        })
        if (from >= 0 && to >= 0) hit = { from, to }
      }
      return false
    })
    return hit
  }
  const ops: EditorOps = {
    markdown: () => htmlToMd(editor?.getHTML() ?? ''),
    sections: () => {
      const out: string[] = []
      editor?.state.doc.descendants((node) => { if (node.type.name === 'heading' && node.attrs.level <= 2) out.push(node.textContent.trim()); return false })
      return out
    },
    currentSection: () => {
      if (!editor) return undefined
      const caret = editor.state.selection.from
      let found: string | undefined
      editor.state.doc.descendants((node, pos) => {
        if (pos > caret) return false
        if (node.type.name === 'heading' && node.attrs.level <= 2) found = node.textContent.trim()
        return false
      })
      return found
    },
    highlight: (quote) => {
      const r = findQuote(quote); if (!r) return false
      editor!.chain().setTextSelection(r).scrollIntoView().run()
      return true
    },
    replaceMarkdown: (md) => {
      if (!editor) return
      const { from } = editor.state.selection
      editor.commands.setContent(mdToHtml(md), { emitUpdate: true })
      editor.commands.setTextSelection(Math.min(from, editor.state.doc.content.size))
    },
    scrollToSection: (heading) => {
      if (!editor) return false
      let at: number | null = null
      editor.state.doc.descendants((node, pos) => {
        if (at !== null) return false
        if (node.type.name === 'heading' && node.attrs.level <= 2 && node.textContent.trim() === heading) at = pos + 1
        return false
      })
      if (at === null) return false
      editor.chain().setTextSelection(at).scrollIntoView().run()
      return true
    }
  }

  // opened from the review pile: land on that section once the editor has content
  useEffect(() => {
    if (!editor || !initialSection) return
    const t = setTimeout(() => ops.scrollToSection(initialSection), 50)
    return () => clearTimeout(t)
  }, [editor, initialSection]) // eslint-disable-line react-hooks/exhaustive-deps

  const mine = graph.filter((g) => g.noteId === note.id)
  const pendingHere = mine.filter((g) => !g.reviewed && isReviewUnit(g, graph)).length
  const reviewedHere = mine.filter((g) => g.reviewed && isReviewUnit(g, graph)).length

  const Btn = ({ on, onClick, title, children }: { on?: boolean; onClick: () => void; title: string; children: ReactNode }) => (
    <button className={on ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); onClick() }} title={title}>{children}</button>
  )

  return (
    <div className="editor-pane">
      <div className="editor-toolbar">
        <button className="back" onClick={onBack} title="Back to notes (⌘[ or Esc)"><ArrowLeft /> Notes</button>
        <span className="saved">{saving ? 'Saving…' : 'Saved'}</span>
        {editor && (
          <div className="format-bar">
            <Btn on={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold  ⌘B"><Bold /></Btn>
            <Btn on={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic  ⌘I"><Italic /></Btn>
            <Btn on={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough  ⇧⌘X"><Strikethrough /></Btn>
            <span className="sep" />
            <Btn on={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().setHeading({ level: 1 }).run()} title="Title  ⇧⌘T"><span className="lbl">Title</span></Btn>
            <Btn on={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().setHeading({ level: 2 }).run()} title="Heading  ⇧⌘H"><span className="lbl">Heading</span></Btn>
            <Btn on={editor.isActive('paragraph') && !editor.isActive('taskList')} onClick={() => editor.chain().focus().setParagraph().run()} title="Body  ⇧⌘B"><span className="lbl">Body</span></Btn>
            <span className="sep" />
            <Btn on={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()} title="Todo  ⇧⌘L"><ListChecks /></Btn>
          </div>
        )}
        <TemplateMenu onInsert={insertTemplate} currentMarkdown={() => htmlToMd(editor?.getHTML() ?? '')} currentTitle={note.title} />
        <button className={`icon-btn ${panel ? 'on' : ''}`} onClick={() => setPanel((v) => !v)} title="File, outline & links  ⇧⌘I">
          <CheckCheck />{pendingHere > 0 && <span className="badge">{pendingHere}</span>}
        </button>
        <button className="icon-btn" onClick={() => onChange({ pinned: !note.pinned })} title={note.pinned ? 'Unpin' : 'Pin'}>
          {note.pinned ? <PinOff /> : <Pin />}
        </button>
        <button className="icon-btn" onClick={onDelete} title="Delete note (⌘⌫)"><Trash2 /></button>
      </div>
      <div className="editor-scroll">
        <div className="editor-inner">
          <div className="note-date">{longDate(note.createdAt)}</div>
          <textarea
            ref={titleRef}
            className="note-title"
            placeholder="Untitled"
            rows={1}
            value={note.title}
            onChange={(e) => onChange({ title: e.target.value.replace(/\n/g, '') })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) {
                e.preventDefault()
                if (editor) { editor.view.focus(); editor.commands.setTextSelection(1) }
              }
            }}
          />
          {(pendingHere > 0 || reviewedHere > 0) && (
            <div className="pills">
              {pendingHere > 0 && <button className="pill review" onClick={() => { setPanelTab('file'); setPanel(true) }} title="Sections not yet reviewed and filed"><CheckCheck />{pendingHere} to review</button>}
              {reviewedHere > 0 && <span className="pill done" title="Sections reviewed and filed"><CheckCheck />{reviewedHere} reviewed</span>}
            </div>
          )}
          <EditorContent editor={editor} />
        </div>
      </div>
      {panel && (
        <>
          <div className="scrim" onClick={() => setPanel(false)} />
          <ContextPanel note={note} graph={graph} ops={ops} onOpenNote={(id) => { setPanel(false); onOpenNote(id) }} onClose={() => setPanel(false)} tab={panelTab} setTab={setPanelTab} fileSection={initialSection ?? undefined} />
        </>
      )}
    </div>
  )
}
