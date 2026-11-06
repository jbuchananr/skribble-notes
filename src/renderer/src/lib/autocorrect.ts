/**
 * Autocorrect: when a word is finished (space or punctuation), a misspelled one is replaced with the
 * system spellchecker's closest suggestion. Backspace right after a correction puts back what you typed.
 * Names, acronyms, code-ish words and words you already use in your notes are left alone.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

const STORAGE_KEY = 'skribble:autocorrect'

export function autocorrectEnabled(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== 'off' } catch { return true }
}
export function setAutocorrectEnabled(on: boolean) {
  try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off') } catch { /* private storage */ }
}

// a word in two or more different notes counts as yours (jargon, names written in lowercase); a typo
// repeated inside the note you are writing does not
let vocabulary = new Set<string>()
export function setVocabulary(texts: string[]) {
  const counts = new Map<string, number>()
  for (const t of texts) for (const w of new Set(t.toLowerCase().match(/[a-z][a-z']+/g) ?? [])) counts.set(w, (counts.get(w) ?? 0) + 1)
  vocabulary = new Set([...counts].filter(([, n]) => n >= 2).map(([w]) => w))
}
// words you reverted this session are not corrected again
const declined = new Set<string>()

/** Damerau-Levenshtein distance, for "is this suggestion a typo fix or a different word" */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** The correction for a word just finished, or null to leave it. `before` is the text preceding the word. */
export function correctionFor(word: string, before: string): string | null {
  if (word.length < 3 || word.length > 24) return null
  if (/[A-Z]/.test(word.slice(1))) return null // ALLCAPS, camelCase, iPhone
  const sentenceStart = /(^|[.!?]["')\]]?\s+)$/.test(before)
  if (/^[A-Z]/.test(word) && !sentenceStart) return null // a name mid-sentence
  if (before && !/[\s("'[{]$/.test(before)) return null // part of a path, URL, handle or tag
  const lower = word.toLowerCase()
  if (vocabulary.has(lower) || declined.has(lower)) return null
  const spell = window.notes?.spell
  if (!spell || !spell.misspelled(word)) return null
  const max = word.length <= 4 ? 1 : 2
  const pick = spell.suggestions(word).find((s) => /^[A-Za-z']+$/.test(s) && distance(lower, s.toLowerCase()) <= max)
  if (!pick) return null
  return /^[A-Z]/.test(word) ? pick[0].toUpperCase() + pick.slice(1) : pick
}

interface Last { start: number; original: string; corrected: string; sep: string }
const key = new PluginKey<Last | null>('autocorrect')
const SEP = /^[\s.,!?;:)\]"']$/

export const Autocorrect = Extension.create({
  name: 'autocorrect',
  addProseMirrorPlugins() {
    return [new Plugin<Last | null>({
      key,
      state: {
        init: () => null,
        apply: (tr, prev) => {
          const meta = tr.getMeta(key)
          if (meta !== undefined) return meta
          return tr.docChanged || tr.selectionSet ? null : prev
        }
      },
      props: {
        handleTextInput(view, from, to, text) {
          // fast typing can arrive as one input ("h " rather than " "), so take any letters ahead of the separator too
          const sep = text.slice(-1)
          const typed = text.slice(0, -1)
          if (from !== to || !SEP.test(sep) || !/^[A-Za-z']*$/.test(typed) || !autocorrectEnabled()) return false
          const $from = view.state.doc.resolve(from)
          if ($from.parent.type.spec.code || $from.marks().some((m) => m.type.name === 'code' || m.type.name === 'link')) return false
          const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 80), $from.parentOffset, undefined, '\ufffc') + typed
          const m = before.match(/([A-Za-z']+)$/)
          if (!m) return false
          const word = m[1].replace(/^'+|'+$/g, '')
          if (!word || !m[1].endsWith(word)) return false
          const fix = correctionFor(word, before.slice(0, before.length - word.length))
          if (!fix || fix === word) return false
          const start = from - (word.length - typed.length)
          const tr = view.state.tr.insertText(fix + sep, start, from)
          tr.setMeta(key, { start, original: word, corrected: fix, sep })
          view.dispatch(tr)
          return true
        },
        handleKeyDown(view, event) {
          if (event.key !== 'Backspace' || event.metaKey || event.altKey || event.ctrlKey) return false
          const last = key.getState(view.state)
          const { from, empty } = view.state.selection
          if (!last || !empty || from !== last.start + last.corrected.length + last.sep.length) return false
          declined.add(last.original.toLowerCase())
          const tr = view.state.tr.insertText(last.original, last.start, from)
          tr.setMeta(key, null)
          view.dispatch(tr)
          event.preventDefault()
          return true
        }
      }
    })]
  }
})
