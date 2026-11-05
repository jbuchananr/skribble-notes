import { Marked, type Tokens } from 'marked'
import TurndownService from 'turndown'
// @ts-expect-error no types shipped
import { gfm } from 'turndown-plugin-gfm'

// ---------- markdown -> TipTap HTML ----------
const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    list(token: Tokens.List) {
      const body = token.items.map((i) => this.listitem(i)).join('')
      const allTasks = token.items.length > 0 && token.items.every((i) => i.task)
      if (allTasks) return `<ul data-type="taskList">${body}</ul>\n`
      if (token.ordered) return `<ol${token.start && token.start !== 1 ? ` start="${token.start}"` : ''}>${body}</ol>\n`
      return `<ul>${body}</ul>\n`
    },
    listitem(item: Tokens.ListItem) {
      if (!item.task) return `<li>${this.parser.parse(item.tokens)}</li>\n`
      // marked emits the checkbox as its own token; drop it, TipTap draws the box itself
      const toks = item.tokens.slice()
      if (toks[0]?.type === 'checkbox') toks.shift()
      else if (toks[0] && 'tokens' in toks[0] && Array.isArray(toks[0].tokens) && toks[0].tokens[0]?.type === 'checkbox') {
        toks[0] = { ...toks[0], tokens: toks[0].tokens.slice(1) } as typeof toks[0]
      }
      const inner = this.parser.parse(toks).replace(/^\s+/, '')
      return `<li data-type="taskItem" data-checked="${item.checked ? 'true' : 'false'}">${inner}</li>\n`
    }
  }
})

/**
 * Collapsible blocks live in markdown as <details><summary>…</summary> … </details> (readable anywhere).
 * TipTap's Details node wants div[data-type] markup, so translate on the way in and out.
 */
function detailsToTiptap(md: string): string {
  return md
    .replace(/^<details( open)?>[ \t]*\n<summary>(.*?)<\/summary>[ \t]*$/gm, (_m, open, sum) =>
      `<div data-type="details"${open ? ' open="true"' : ''}><summary data-type="detailsSummary">${sum}</summary><div data-type="detailsContent">`)
    .replace(/^<\/details>[ \t]*$/gm, '</div></div>')
}

export function mdToHtml(md: string): string {
  if (!md.trim()) return ''
  // an empty "- [ ]" line is not a task item to marked; give it an invisible body so templates render checkboxes
  const prepped = detailsToTiptap(md).replace(/^(\s*[-*] \[[ xX]\])\s*$/gm, '$1 \u00a0')
  // a line holding only a non-breaking space is a deliberate blank line; give the editor an empty paragraph
  return (marked.parse(prepped) as string).replace(/<p>(?:\u00a0|&nbsp;)<\/p>/g, '<p></p>')
}

// ---------- TipTap HTML -> markdown ----------
const td = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  // turndown drops blank nodes before rules run; keep a deliberate empty paragraph as a line holding "&nbsp;"
  blankReplacement: (_content, node) =>
    node.nodeName === 'P' ? '\n\n&nbsp;\n\n' : (node as HTMLElement & { isBlock?: boolean }).isBlock ? '\n\n' : ''
})
td.use(gfm)
// TipTap task items: <li data-type="taskItem" data-checked="true"><label>…</label><div><p>text</p></div></li>
td.addRule('tiptapTaskLabel', {
  filter: (node) => node.nodeName === 'LABEL' && node.parentElement?.getAttribute('data-type') === 'taskItem',
  replacement: () => ''
})
td.addRule('tiptapTaskItem', {
  filter: (node) => node.nodeName === 'LI' && node.getAttribute('data-type') === 'taskItem',
  replacement: (content, node) => {
    const checked = (node as HTMLElement).getAttribute('data-checked') === 'true'
    const body = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n  ')
    return `- [${checked ? 'x' : ' '}] ${body.trim()}\n`
  }
})

// bare URLs stay bare (marked autolinks them again on the way back in)
td.addRule('bareAutolink', {
  filter: (node) => node.nodeName === 'A' && !!node.getAttribute('href') && (node.textContent ?? '').trim() === node.getAttribute('href'),
  replacement: (_c, node) => (node as HTMLElement).getAttribute('href') ?? ''
})
td.addRule('tiptapDetails', {
  filter: (node) => node.nodeName === 'DIV' && node.getAttribute('data-type') === 'details',
  replacement: (_content, node) => {
    const el = node as HTMLElement
    const summary = el.querySelector('summary')?.textContent?.trim() || 'Details'
    const inner = el.querySelector('[data-type="detailsContent"]')
    const open = el.hasAttribute('open') && el.getAttribute('open') !== 'false'
    const body = inner ? td.turndown(inner.innerHTML).trim() : ''
    return `\n\n<details${open ? ' open' : ''}>\n<summary>${summary}</summary>\n\n${body}\n\n</details>\n\n`
  }
})

export function htmlToMd(html: string): string {
  if (!html.trim()) return ''
  return td.turndown(html)
    .replace(/\\\[\\\[([^\]]*?)\\\]\\\]/g, '[[$1]]') // keep [[wikilinks]] intact
    .replace(/^(\s*)-   /gm, '$1- ')
    .replace(/^(\s*\d+\.)  /gm, '$1 ')
    .replace(/^(\s*- \[[ x]\]) ?\u00a0\s*$/gm, '$1')
    .trim() + '\n'
}

/** plain text for previews and search */
export function mdToText(md: string): string {
  return md
    .replace(/^---[\s\S]*?---\n/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\u00a0/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, '$1')
    .replace(/^[#>\-*+\s]+|^\d+\.\s+/gm, '')
    .replace(/\[[ x]\]\s*/g, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractWikilinks(md: string): string[] {
  const out = new Set<string>()
  for (const m of md.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) out.add(m[1].trim())
  return [...out]
}

export function extractTags(md: string): string[] {
  const out = new Set<string>()
  const noCode = md.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')
  for (const m of noCode.matchAll(/(?:^|\s)#([a-zA-Z][\w/-]*)/g)) out.add(m[1].toLowerCase())
  return [...out]
}
