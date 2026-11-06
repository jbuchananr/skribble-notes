import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details'
import type { GraphNode, Note, Template } from '../../../shared/types'
import { longDate } from '@/lib/dates'
import { mdToHtml } from '../../../core/markdown'
import { renderTemplate } from '../../../core/template-render'
import { isUnit } from '../../../core/inbox'
import { CopyButton } from './CopyButton'
import { noteMarkdown } from '@/lib/copy'
import { Autocorrect } from '@/lib/autocorrect'
import { Trash2, Bold, Italic, Strikethrough, ListChecks } from './Icons'

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
      'Mod-Shift-m': () => fire('skribble:template:Meeting'),
      'Mod-Shift-r': () => fire('skribble:template:Reflection')
    }
  }
})

/**
 * A quiet tag at the end of each H1/H2 heading: "inbox" or "absorbed Nov 5". Click it to absorb.
 * Pure decoration; nothing is in the document.
 */
type Status = Map<string, { absorbed?: string }>
const statusKey = new PluginKey<Status>('skribbleStatus')
const fmt = (iso: string) => { const t = Date.parse(iso + 'T12:00:00'); return Number.isNaN(t) ? iso : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }
const HeadingStatus = Extension.create({
  name: 'skribbleHeadingStatus',
  addProseMirrorPlugins() {
    return [new Plugin<Status>({
      key: statusKey,
      state: {
        init: () => new Map(),
        apply: (tr, prev) => tr.getMeta(statusKey) ?? prev
      },
      props: {
        decorations(state) {
          const status = statusKey.getState(state)
          if (!status || !status.size) return null
          const decos: Decoration[] = []
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'heading' || node.attrs.level > 2) return
            const st = status.get(node.textContent.trim())
            if (!st) return
            const heading = node.textContent.trim()
            decos.push(Decoration.widget(pos + node.nodeSize - 1, () => {
              const el = document.createElement('button')
              el.className = `heading-status ${st.absorbed ? 'done' : 'inbox'}`
              el.contentEditable = 'false'
              el.textContent = st.absorbed ? `absorbed ${fmt(st.absorbed)}` : 'to absorb'
              el.title = st.absorbed ? 'Absorbed. Click to absorb again.' : 'Not absorbed yet. Click to absorb.'
              el.onmousedown = (e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('skribble:absorb', { detail: heading })) }
              return el
            }, { side: 1, key: `${heading}:${st.absorbed ?? 'inbox'}` }))
            return false
          })
          return DecorationSet.create(state.doc, decos)
        }
      }
    })]
  }
})

interface Props {
  note: Note
  saving: boolean
  /** scroll to this section on open */
  initialSection?: string | null
  graph: GraphNode[]
  onChange: (patch: Partial<Note>) => void
  onDelete: () => void
  onAbsorb: (section?: string) => void
  /** shown before "Saved", e.g. the show-sidebar button when the sidebar is hidden */
  leading?: ReactNode
  /** the sidebar is hidden, so the toolbar starts beside the window controls */
  clearTrafficLights?: boolean
}

const SERIALIZE_DELAY = 300

export function Editor({ note, saving, initialSection, graph, onChange, onDelete, onAbsorb, leading, clearTrafficLights }: Props) {
  const titleRef = useRef<HTMLTextAreaElement>(null)
  // last HTML we handed to the app; lets us tell our own saves from edits made on disk (MCP write, import, absorb)
  const lastHtml = useRef(note.content)
  const serializeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onAbsorbRef = useRef(onAbsorb)
  onAbsorbRef.current = onAbsorb

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: true, autolink: true } }),
      Shortcuts,
      Autocorrect,
      HeadingStatus,
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

  // heading tags: inbox / absorbed, from the graph
  useEffect(() => {
    if (!editor) return
    const status: Status = new Map()
    // a note is absorbed as a whole, so headings carry no tag; the note's tag sits under the title
    editor.view.dispatch(editor.state.tr.setMeta(statusKey, status))
  }, [editor, graph, note.id, note.content])

  useEffect(() => {
    const h = (e: Event) => onAbsorbRef.current((e as CustomEvent<string>).detail)
    window.addEventListener('skribble:absorb', h)
    return () => window.removeEventListener('skribble:absorb', h)
  }, [])

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

  // opened at a section: scroll there once the editor has content
  useEffect(() => {
    if (!editor || !initialSection) return
    const t = setTimeout(() => {
      let at: number | null = null
      editor.state.doc.descendants((node, pos) => {
        if (at !== null) return false
        if (node.type.name === 'heading' && node.attrs.level <= 2 && node.textContent.trim() === initialSection) at = pos + 1
        return false
      })
      if (at !== null) editor.chain().setTextSelection(at).scrollIntoView().run()
    }, 50)
    return () => clearTimeout(t)
  }, [editor, initialSection])

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
    const tpl = (name: string) => async () => {
      const t = (await window.notes.listTemplates()).find((x) => x.name === name)
      if (t) insertTemplate(t)
    }
    const m = tpl('Meeting'); const r = tpl('Reflection')
    window.addEventListener('skribble:template:Meeting', m)
    window.addEventListener('skribble:template:Reflection', r)
    return () => {
      window.removeEventListener('skribble:template:Meeting', m)
      window.removeEventListener('skribble:template:Reflection', r)
    }
  }, [insertTemplate])

  const mine = graph.filter((g) => g.noteId === note.id)
  const whole = mine.find((g) => g.level === 0 && isUnit(g, graph))

  const Btn = ({ on, onClick, title, children }: { on?: boolean; onClick: () => void; title: string; children: ReactNode }) => (
    <button className={on ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); onClick() }} title={title}>{children}</button>
  )

  return (
    <div className="editor-pane">
      <div className={`editor-toolbar ${leading ? 'has-lead' : ''} ${clearTrafficLights ? 'clear-lights' : ''}`}>
        <div className="toolbar-start">{leading}<span className="saved">{saving ? 'Saving…' : 'Saved'}</span></div>
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
        {!editor && <span />}
        <div className="toolbar-end">
          <CopyButton title="Copy note as markdown" text={() => noteMarkdown({ ...note, content: editor?.getHTML() ?? note.content })} />
          <button className="icon-btn" onClick={onDelete} title="Delete note (⌘⌫)"><Trash2 /></button>
        </div>
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
          {whole && (
            <div className="pills">
              <button className={`heading-status ${whole.absorbed ? 'done' : 'inbox'} standalone`} onClick={() => onAbsorb(undefined)}>
                {whole.absorbed ? `absorbed ${fmt(whole.absorbed)}` : 'to absorb'}
              </button>
            </div>
          )}
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}
