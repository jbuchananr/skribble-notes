/**
 * The Actions note: capture, synthesize, act. It holds what you are practicing and what you are acting on
 * (to-dos, project changes, things to share). Actions are filed when you absorb a section: the model writes
 * them so each stands on its own and skips anything already listed; without a key, the "Action Items" lists
 * and unchecked todos in the section are filed as written. It is a plain markdown note, edited one line at a
 * time, so anything else you write there stays.
 */
import { randomUUID, createHash } from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { ActionItem, ActionKind, ActionList, ActionsEdit, ActionsState } from '../shared/types'
import * as store from './store'
import { NOTES_DIR } from './paths'
import { unitMarkdown } from './sections'
import { isInsightsNote } from './graph'
import { extractActions } from './ai/actions'
import type { AiConfig } from './ai/config'

/** Each list is an H2 section of the note. Older headings are still recognized. */
const LISTS: { list: ActionList; heading: string; match: RegExp }[] = [
  { list: 'practices', heading: 'Practicing', match: /^(practicing|practices|reflection action items?)$/i },
  { list: 'todo', heading: 'To do', match: /^(to ?-?do|todos?|action items?)$/i },
  { list: 'change', heading: 'Project changes', match: /^(project )?changes$/i },
  { list: 'share', heading: 'To share', match: /^(to )?share$/i }
]
const TASK_LISTS = LISTS.filter((l) => l.list !== 'practices')
/** which units were filed and what their text was then, so an unchanged section is never filed twice */
const LEDGER = join(NOTES_DIR, '.actions.json')

// ---------- extraction without a model ----------

/** "Action Items", "**Action Items:**", "### Next steps", "TODO:" and the like, alone on a line */
const LABEL_RE = /^\s*(?:#{1,6}\s+)?(?:\*\*|__)?\s*(?:action items?|next steps?|to-?dos?|follow[- ]ups?)\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i
/** "Takeaways for next time:", "Lessons", "Do better" and the like: what follows is a practice, not a task */
const PRACTICE_LABEL_RE = /^\s*(?:#{1,6}\s+)?(?:\*\*|__)?\s*(?:(?:key )?takeaways? for next time|next time|lessons?(?: learned)?|do better|to improve)\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i
/** a single line like "Next time: ensure slide ordering matches…" */
const PRACTICE_LINE_RE = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?next time(?:\*\*|__)?\s*:\s*(.+)$/i
const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s*)?(.*)$/
const isBlank = (l: string) => /^\s*(?:&nbsp;| )?\s*$/.test(l)

/** plain text of a list item: markdown escapes and bold markers removed, whitespace collapsed */
export const cleanItem = (s: string) => s.replace(/\\([\\`*_{}[\]()#+\-.!|])/g, '$1').replace(/\*\*|__/g, '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
/** comparison key: case, punctuation and spacing do not make two items different */
export const itemKey = (s: string) => cleanItem(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const FILLER = new Set(['and', 'the', 'for', 'with', 'from', 'into', 'about', 'that', 'this'])
/** content words with common endings removed, so "implementing" matches "implement" */
const words = (s: string) => new Set(itemKey(s).split(' ').filter((w) => w.length > 2 && !FILLER.has(w)).map((w) => (w.length > 5 ? w.replace(/(ing|ed|es|s)$/, '') : w)))
/** Same action worded a little differently: one contains the other, or most of their words are shared. */
export function similar(a: string, b: string): boolean {
  const ka = itemKey(a), kb = itemKey(b)
  if (!ka || !kb) return false
  if (ka === kb) return true
  const [short, long] = ka.length < kb.length ? [ka, kb] : [kb, ka]
  if (short.length >= 12 && long.includes(short)) return true
  const wa = words(a), wb = words(b)
  if (wa.size < 3 || wb.size < 3) return false
  let both = 0
  for (const w of wa) if (wb.has(w)) both++
  return both / (wa.size + wb.size - both) >= 0.6
}

/**
 * Action items in a piece of markdown: every list item under an action-items label, plus unchecked
 * "- [ ]" todos anywhere. A nested bullet is folded into its parent ("Jonathan: Implement habits").
 * Checked items are skipped; they are already done.
 */
export function extractActionItems(md: string): string[] {
  return extractLists(md).filter((x) => x.list === 'todo').map((x) => x.text)
}

/** Tasks and practices in a piece of markdown, as written. Used when no model is configured. */
export function extractLists(md: string): { list: 'todo' | 'practices'; text: string }[] {
  const out: { list: 'todo' | 'practices'; text: string }[] = []
  let inList: false | 'todo' | 'practices' = false
  let cur: { text: string; indent: number; kids: string[]; skip: boolean } | null = null
  const flush = () => {
    if (cur && !cur.skip) {
      const t = cleanItem(cur.kids.length ? `${cur.text}: ${cur.kids.join('; ')}` : cur.text)
      if (t && inList) out.push({ list: inList, text: t })
    }
    cur = null
  }
  for (const line of md.split('\n')) {
    if (LABEL_RE.test(line)) { flush(); inList = 'todo'; continue }
    if (PRACTICE_LABEL_RE.test(line)) { flush(); inList = 'practices'; continue }
    const once = line.match(PRACTICE_LINE_RE)
    if (once && cleanItem(once[1])) { flush(); out.push({ list: 'practices', text: cleanItem(once[1]) }); continue }
    const m = line.match(LIST_RE)
    if (inList) {
      if (isBlank(line)) continue
      if (m) {
        const indent = m[1].replace(/\t/g, '    ').length
        if (cur && indent > cur.indent) { const k = cleanItem(m[3]); if (k) cur.kids.push(k); continue }
        flush()
        cur = { text: m[3], indent, kids: [], skip: !!m[2] && m[2] !== ' ' }
        continue
      }
      if (cur && /^\s{2,}\S/.test(line)) { cur.text += ' ' + line.trim(); continue }
      flush(); inList = false
    }
    if (m && m[2] === ' ' && cleanItem(m[3])) out.push({ list: 'todo', text: cleanItem(m[3]) })
  }
  flush()
  return out.filter((t, i) => !out.slice(0, i).some((o) => similar(o.text, t.text)))
}

// ---------- the note ----------

const HEADING_RE = /^(#{1,2})\s+(.+?)\s*#*\s*$/
const SOURCE_RE = /\s+·\s+\[\[([^\]]+)\]\]\s*$/

type Range = { heading: number; end: number }

function findSection(lines: string[], match: RegExp): Range | null {
  let inCode = false
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) inCode = !inCode
    const h = !inCode && lines[i].match(HEADING_RE)
    if (!h || !match.test(h[2].trim())) continue
    let end = lines.length
    for (let j = i + 1; j < lines.length; j++) if (HEADING_RE.test(lines[j])) { end = j; break }
    return { heading: i, end }
  }
  return null
}

type Line = { line: number; text: string; done: boolean; source?: string }

function parseLine(line: string): Omit<Line, 'line'> | null {
  const m = line.match(LIST_RE)
  if (!m || m[1].length > 1) return null
  let rest = m[3]
  const src = rest.match(SOURCE_RE)
  if (src) rest = rest.slice(0, src.index)
  const text = cleanItem(rest)
  if (!text) return null
  return { text, done: !!m[2] && m[2] !== ' ', ...(src ? { source: src[1].trim() } : {}) }
}

function linesOf(lines: string[], list: ActionList): Line[] {
  const r = findSection(lines, LISTS.find((l) => l.list === list)!.match)
  if (!r) return []
  const out: Line[] = []
  for (let i = r.heading + 1; i < r.end; i++) { const p = parseLine(lines[i]); if (p) out.push({ line: i, ...p }) }
  return out
}

export function parseActions(body: string): Pick<ActionsState, 'practices' | 'items'> {
  const lines = body.split('\n')
  return {
    practices: linesOf(lines, 'practices').map((x) => x.text),
    items: TASK_LISTS.flatMap(({ list }) => linesOf(lines, list).map((x): ActionItem => ({ text: x.text, done: x.done, kind: list as ActionKind, ...(x.source ? { source: x.source } : {}) })))
  }
}

/** Insert list lines into a list's section: at the top of its items, or after the last one. Adds the section if missing. */
function insertInto(lines: string[], list: ActionList, add: string[], where: 'top' | 'bottom'): string[] {
  const out = lines.slice()
  const spec = LISTS.find((l) => l.list === list)!
  let r = findSection(out, spec.match)
  if (!r) {
    // place a missing section before the next list that follows it, so the note keeps its order
    const later = LISTS.slice(LISTS.indexOf(spec) + 1).map((l) => findSection(out, l.match)).find(Boolean)
    if (later) {
      out.splice(later.heading, 0, `## ${spec.heading}`, '', '')
      r = { heading: later.heading, end: later.heading + 2 }
    } else {
      while (out.length && isBlank(out[out.length - 1])) out.pop()
      out.push(...(out.length ? [''] : []), `## ${spec.heading}`, '')
      r = { heading: out.length - 2, end: out.length }
    }
  }
  const items = linesOf(out, list)
  if (items.length) {
    const at = where === 'top' ? items[0].line : items[items.length - 1].line + 1
    out.splice(at, 0, ...add)
  } else {
    const after = out[r.heading + 1]
    out.splice(r.heading + 1, 0, '', ...add, ...(after !== undefined && !isBlank(after) ? [''] : []))
  }
  return out
}

const EMPTY_BODY = LISTS.map((l) => `## ${l.heading}\n`).join('\n')

export async function findActionsNote(): Promise<store.StoredNote | undefined> {
  return (await store.listStored()).find((n) => n.kind === 'actions')
}

/** Rename what the first version called "Action Items" / "Reflection action items" / "Action items". */
function migrate(n: store.StoredNote): store.StoredNote | null {
  const body = n.body
    .replace(/^##\s+Reflection action items\s*$/im, '## Practicing')
    .replace(/^##\s+Action items\s*$/im, '## To do')
  const title = n.title === 'Action Items' ? 'Actions' : n.title
  return body === n.body && title === n.title ? null : { ...n, title, body }
}

async function ensureActionsNote(): Promise<store.StoredNote> {
  const found = await findActionsNote()
  if (found) {
    const m = migrate(found)
    return m ? store.writeStored(m) : found
  }
  const now = Date.now()
  return store.writeStored({ id: randomUUID(), title: 'Actions', body: EMPTY_BODY, pinned: false, tags: [], absorbed: [], createdAt: now, updatedAt: now, kind: 'actions' })
}

async function writeBody(n: store.StoredNote, lines: string[]): Promise<store.StoredNote> {
  const body = lines.join('\n').replace(/^(#{1,2} .+)\n(?=\S)/gm, '$1\n\n').replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '\n')
  return store.writeStored({ ...n, body, updatedAt: Date.now() })
}

// every change to the note or the ledger goes through one queue, so a background catch-up and a click never interleave
let chain: Promise<unknown> = Promise.resolve()
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => undefined)
  return run
}

const stateOf = (n: store.StoredNote): ActionsState => ({ noteId: n.id, ...parseActions(n.body) })

export function readActions(): Promise<ActionsState> {
  return locked(async () => stateOf(await ensureActionsNote()))
}

type Ledger = Record<string, string>
async function readLedger(): Promise<Ledger> {
  try {
    const d = JSON.parse(await fs.readFile(LEDGER, 'utf8'))
    return d && typeof d.units === 'object' ? d.units : {}
  } catch { return {} }
}
async function writeLedger(units: Ledger) {
  await fs.writeFile(LEDGER, JSON.stringify({ units }, null, 2) + '\n', 'utf8')
}

export function editActions(edit: ActionsEdit, cfg?: AiConfig | null): Promise<ActionsState> {
  return locked(async () => {
    const n = await ensureActionsNote()
    let lines = n.body.split('\n')
    const task = (l: Line) => TASK_LISTS.some(({ list }) => linesOf(lines, list).some((x) => x.line === l.line))
    const allTasks = () => TASK_LISTS.flatMap(({ list }) => linesOf(lines, list))
    if (edit.op === 'add') {
      const text = cleanItem(edit.text)
      if (!text) throw new Error('Nothing to add')
      lines = edit.list === 'practices' ? insertInto(lines, 'practices', [`- ${text}`], 'bottom') : insertInto(lines, edit.list, [`- [ ] ${text}`], 'top')
    } else if (edit.op === 'remove') {
      const hit = linesOf(lines, edit.list).find((x) => itemKey(x.text) === itemKey(edit.text))
      if (hit) lines.splice(hit.line, 1)
    } else if (edit.op === 'toggle') {
      const hit = allTasks().find((x) => itemKey(x.text) === itemKey(edit.text))
      if (hit && task(hit)) lines[hit.line] = lines[hit.line].replace(/^(\s*(?:[-*+]|\d+[.)])\s+)(?:\[([ xX])\]\s*)?/, (_m, lead, box) => `${lead}[${box && box !== ' ' ? ' ' : 'x'}] `)
    } else if (edit.op === 'clear-done') {
      const done = new Set(allTasks().filter((x) => x.done).map((x) => x.line))
      lines = lines.filter((_, i) => !done.has(i))
    } else if (edit.op === 'rebuild') {
      // open items that came from a note go; done items and ones you added by hand stay
      const drop = new Set(allTasks().filter((x) => !x.done && x.source).map((x) => x.line))
      lines = lines.filter((_, i) => !drop.has(i))
      await writeBody(n, lines)
      const ledger: Ledger = {}
      await fileAll(ledger, cfg ?? null)
      await writeLedger(ledger)
      return stateOf(await ensureActionsNote())
    }
    return stateOf(await writeBody(n, lines))
  })
}

const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12)

/** File one absorbed unit. Skips it when its text is unchanged since it was last filed. Returns how many lines were added. */
async function fileUnit(note: store.StoredNote, section: string | undefined, ledger: Ledger, cfg: AiConfig | null, takeaway?: string): Promise<number> {
  if (note.kind === 'actions' || isInsightsNote(note)) return 0
  const md = unitMarkdown(note.body, section)
  if (md === null || !md.trim()) return 0
  const unit = `${note.id}#${section ?? ''}`
  const h = hash(md)
  if (ledger[unit] === h) return 0
  const target = await ensureActionsNote()
  const state = parseActions(target.body)
  const existing = [
    ...state.practices.map((text) => ({ list: 'practices' as ActionList, text })),
    ...state.items.map((i) => ({ list: i.kind as ActionList, text: i.done ? `${i.text} (done)` : i.text }))
  ]
  let found: { list: ActionList; text: string }[]
  if (cfg) {
    try {
      found = await extractActions({ noteTitle: note.title, section, text: md, takeaway, existing }, cfg)
    } catch (e) {
      console.error('action extraction failed, filing the Action Items lists as written', (e as Error).message)
      found = extractLists(md)
    }
  } else found = extractLists(md)

  // the model is told to skip what is listed; this catches what it misses, done items included
  const known = [...state.practices, ...state.items.map((i) => i.text)]
  found = found.map((f) => ({ ...f, text: cleanItem(f.text).replace(/\.$/, '') }))
  const fresh = found.filter((f, i) => !known.some((k) => similar(k, f.text)) && !found.slice(0, i).some((o) => similar(o.text, f.text)))
  const title = note.title.trim() || 'Untitled'
  const src = section ? `${title}#${section}` : title
  let lines = target.body.split('\n')
  for (const { list } of LISTS) {
    const mine = fresh.filter((f) => f.list === list)
    if (!mine.length) continue
    lines = list === 'practices'
      ? insertInto(lines, list, mine.map((f) => `- ${cleanItem(f.text)}`), 'bottom')
      : insertInto(lines, list, mine.map((f) => `- [ ] ${cleanItem(f.text)} · [[${src}]]`), 'top')
  }
  if (fresh.length) await writeBody(target, lines)
  ledger[unit] = h
  return fresh.length
}

async function fileAll(ledger: Ledger, cfg: AiConfig | null): Promise<number> {
  let total = 0
  // oldest first, so the newest actions end up at the top of each list
  for (const n of (await store.listStored()).reverse()) for (const a of n.absorbed) total += await fileUnit(n, a.section, ledger, cfg)
  return total
}

/** File the actions of one absorbed unit. Returns how many were added. */
export function fileActionItems(note: store.StoredNote, section: string | undefined, cfg: AiConfig | null, takeaway?: string): Promise<number> {
  return locked(async () => {
    const ledger = await readLedger()
    const n = await fileUnit(note, section, ledger, cfg, takeaway)
    await writeLedger(ledger)
    return n
  })
}

/** File actions from everything absorbed so far; units already filed with the same text are skipped. */
export function fileAllAbsorbed(cfg: AiConfig | null): Promise<number> {
  return locked(async () => {
    const ledger = await readLedger()
    const total = await fileAll(ledger, cfg)
    await writeLedger(ledger)
    return total
  })
}
