/**
 * Skribble MCP server (stdio). Exposes your markdown notes, the link graph, the review pile and the
 * filing actions to any MCP client: Claude, Claude Code, ChatGPT, Cursor, custom agents.
 *
 *   claude mcp add skribble -- node /path/to/skribble/out/mcp/server.mjs
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import * as store from '../core/store'
import { buildGraph, related, nodesForNote, label } from '../core/graph'
import { parseSections } from '../core/sections'
import { applyFiling, existingLinks, today } from '../core/filing'
import { reviewQueue, reviewedUnits } from '../core/review'
import { addInsight } from '../core/insights'
import { readAiConfig } from '../core/ai/config'
import { suggestFiling } from '../core/ai/file'
import { ask, publishedPassages, retrieve } from '../core/ai/ask'
import { listTemplates, renderTemplate } from '../core/templates'
import { mdToText } from '../core/markdown'
import { NOTES_DIR } from '../core/paths'

const server = new McpServer({ name: 'skribble', version: '0.2.0' })

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })

function summary(n: store.StoredNote) {
  return {
    id: n.id,
    title: n.title || 'Untitled',
    updated: new Date(n.updatedAt).toISOString(),
    created: new Date(n.createdAt).toISOString(),
    tags: n.tags.length ? n.tags : undefined,
    preview: mdToText(n.body).slice(0, 160)
  }
}

async function renderNote(n: store.StoredNote) {
  let out = `# ${n.title || 'Untitled'}\n`
  out += `id: ${n.id}\ncreated: ${new Date(n.createdAt).toISOString()}\nupdated: ${new Date(n.updatedAt).toISOString()}\n`
  if (n.tags.length) out += `tags: ${n.tags.join(', ')}\n`
  const graph = buildGraph(await store.listStored())
  const mine = nodesForNote(graph, n.id)
  const links = [...new Set(mine.flatMap((m) => m.links))].map((id) => graph.find((g) => g.id === id)!).filter(Boolean)
  const backlinks = [...new Set(mine.flatMap((m) => m.backlinks))].map((id) => graph.find((g) => g.id === id)!).filter(Boolean)
  if (links.length) out += `links to: ${links.map(label).join('; ')}\n`
  if (backlinks.length) out += `linked from: ${backlinks.map(label).join('; ')}\n`
  const secs = parseSections(n.body)
  if (secs.length) out += `sections: ${secs.map((x) => x.heading).join(' | ')}\n`
  const pending = mine.filter((m) => !m.reviewed && m.level > 0 && m.level <= 2).map((m) => m.section)
  if (pending.length) out += `not yet reviewed: ${pending.join(' | ')}\n`
  out += `\n${n.body}\n`
  return out
}

server.registerTool('list_notes', {
  description: `List notes (most recently updated first). Notes live as markdown files in ${NOTES_DIR}.`,
  inputSchema: { tag: z.string().optional(), limit: z.number().int().min(1).max(500).default(50) }
}, async ({ tag, limit }) => {
  let notes = await store.listStored()
  if (tag) notes = notes.filter((n) => n.tags.includes(tag.toLowerCase().replace(/^#/, '')))
  return text(JSON.stringify(notes.slice(0, limit).map(summary), null, 2))
})

server.registerTool('search_notes', {
  description: 'Full-text search across note titles and bodies. Returns matching notes with a snippet.',
  inputSchema: { query: z.string(), limit: z.number().int().min(1).max(100).default(20) }
}, async ({ query, limit }) => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const hits = (await store.listStored())
    .map((n) => {
      const hay = `${n.title}\n${mdToText(n.body)}`.toLowerCase()
      const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0) + (n.title.toLowerCase().includes(query.toLowerCase()) ? 2 : 0)
      const i = hay.indexOf(terms[0] ?? '')
      return { n, score, snippet: i >= 0 ? hay.slice(Math.max(0, i - 80), i + 120) : '' }
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || b.n.updatedAt - a.n.updatedAt)
    .slice(0, limit)
  return text(JSON.stringify(hits.map((h) => ({ ...summary(h.n), snippet: h.snippet })), null, 2))
})

server.registerTool('read_note', {
  description: 'Read a note as markdown, with its links, backlinks, sections, and which sections are not yet reviewed.',
  inputSchema: { id: z.string().describe('note id, or an exact title') }
}, async ({ id }) => {
  const notes = await store.listStored()
  const n = notes.find((x) => x.id === id) ?? notes.find((x) => x.title.toLowerCase() === id.toLowerCase())
  if (!n) return { ...text(`No note with id or title "${id}"`), isError: true }
  return text(await renderNote(n))
})

server.registerTool('create_note', {
  description: 'Create a new markdown note. Use [[Title]] to link other notes and #tags for tags.',
  inputSchema: { title: z.string(), body: z.string().default('') }
}, async ({ title, body }) => {
  const now = Date.now()
  const id = randomUUID()
  await store.writeStored({ id, title, body, pinned: false, tags: [], createdAt: now, updatedAt: now })
  return text(`Created note ${id} "${title}"`)
})

server.registerTool('update_note', {
  description: 'Replace the body (markdown) and/or title of a note. The user\'s notes are their own thinking: only do this when they asked for exactly this edit.',
  inputSchema: { id: z.string(), title: z.string().optional(), body: z.string().optional() }
}, async ({ id, title, body }) => {
  const n = await store.readStored(id)
  if (!n) return { ...text(`No note ${id}`), isError: true }
  if (title !== undefined) n.title = title
  if (body !== undefined) n.body = body
  n.updatedAt = Date.now()
  await store.writeStored(n)
  return text(`Updated ${id}`)
})

server.registerTool('append_to_note', {
  description: 'Append markdown to the end of a note.',
  inputSchema: { id: z.string(), markdown: z.string() }
}, async ({ id, markdown }) => {
  const n = await store.readStored(id)
  if (!n) return { ...text(`No note ${id}`), isError: true }
  n.body = n.body.replace(/\s+$/, '') + '\n\n' + markdown.trim() + '\n'
  n.updatedAt = Date.now()
  await store.writeStored(n)
  return text(`Appended to ${id}`)
})

server.registerTool('get_graph', {
  description: 'The knowledge graph. One node per section of a note (long notes are made of dated sections like "Standup 10/13"), each with tags, [[links]], backlinks and its reviewed date. Node ids are "<noteId>" or "<noteId>#<section-slug>".',
  inputSchema: { id: z.string().optional().describe('a note id or node id: return only it and its neighbours') }
}, async ({ id }) => {
  const graph = buildGraph(await store.listStored())
  if (!id) return text(JSON.stringify(graph, null, 2))
  const mine = graph.filter((g) => g.id === id || g.noteId === id)
  const neighbours = [...new Set(mine.flatMap((m) => [...m.links, ...m.backlinks]))].map((x) => graph.find((g) => g.id === x)!).filter(Boolean)
  return text(JSON.stringify({ nodes: mine, neighbours, related: mine.length === 1 ? related(graph, mine[0].id) : undefined }, null, 2))
})

server.registerTool('read_section', {
  description: 'Read one section of a long note by heading (e.g. "QC/Tech Integration  10/14").',
  inputSchema: { note_id: z.string(), heading: z.string().describe('exact or partial heading text') }
}, async ({ note_id, heading }) => {
  const n = await store.readStored(note_id)
  if (!n) return { ...text(`No note ${note_id}`), isError: true }
  const secs = parseSections(n.body)
  const sec = secs.find((x) => x.heading === heading) ?? secs.find((x) => x.heading.toLowerCase().includes(heading.toLowerCase()))
  if (!sec) return { ...text(`No section matching "${heading}". Sections: ${secs.map((x) => x.heading).join(' | ')}`), isError: true }
  return text(`## ${sec.heading}\n${sec.text}\n`)
})

server.registerTool('append_section', {
  description: 'Append a new section to a long-running note, optionally from a template ("Meeting", "Reflection", or any saved template). Placeholders {{date}} are filled with today.',
  inputSchema: { note_id: z.string(), heading: z.string().optional().describe('used as the H2 heading when no template is given'), markdown: z.string().default(''), template: z.string().optional() }
}, async ({ note_id, heading, markdown, template }) => {
  const n = await store.readStored(note_id)
  if (!n) return { ...text(`No note ${note_id}`), isError: true }
  let block = ''
  if (template) {
    const t = (await listTemplates()).find((x) => x.name.toLowerCase() === template.toLowerCase())
    if (!t) return { ...text(`No template "${template}"`), isError: true }
    block = renderTemplate(t.body)
    if (heading) block = block.replace(/^## .*$/m, `## ${heading}`)
  } else if (heading) {
    block = `## ${heading}\n\n`
  }
  block += markdown.trim() ? markdown.trim() + '\n' : ''
  n.body = n.body.replace(/\s+$/, '') + '\n\n' + block
  n.updatedAt = Date.now()
  await store.writeStored(n)
  return text(`Appended section to ${note_id}`)
})

// ---------- review & filing ----------
server.registerTool('list_unreviewed', {
  description: 'The review pile: sections (or whole notes without headings) the user has written but not yet synthesized and filed, newest first. Each needs a "Reviewed:" line, added with mark_reviewed after the user has decided its takeaway.',
  inputSchema: { limit: z.number().int().min(1).max(200).default(30) }
}, async ({ limit }) => {
  const queue = reviewQueue(buildGraph(await store.listStored()))
  return text(JSON.stringify(queue.slice(0, limit).map((n) => ({ note_id: n.noteId, note: n.noteTitle || 'Untitled', section: n.section, date: n.date, preview: n.preview })), null, 2))
})

server.registerTool('list_reviewed', {
  description: 'Sections the user has reviewed and filed, most recently reviewed first. This is their published thinking; prefer it over unreviewed notes when answering questions.',
  inputSchema: { limit: z.number().int().min(1).max(200).default(30) }
}, async ({ limit }) => {
  const units = reviewedUnits(buildGraph(await store.listStored()))
  return text(JSON.stringify(units.slice(0, limit).map((n) => ({ note_id: n.noteId, note: n.noteTitle || 'Untitled', section: n.section, reviewed: n.reviewed, tags: n.tags, preview: n.preview })), null, 2))
})

server.registerTool('search_reviewed', {
  description: 'Find the reviewed sections and insight cards most relevant to a question, with their full text. Use this to answer from the user\'s settled thinking without calling a model.',
  inputSchema: { query: z.string(), limit: z.number().int().min(1).max(20).default(6) }
}, async ({ query, limit }) => {
  const hits = retrieve(query, [], publishedPassages(await store.listStored()), limit)
  return text(JSON.stringify(hits.map((p) => ({ node_id: p.id, note_id: p.noteId, label: p.label, reviewed: p.reviewed, text: p.text })), null, 2))
})

server.registerTool('ask_reviewed', {
  description: 'Ask a question answered only from the user\'s reviewed sections and insight cards, with citations. Needs the OpenRouter key configured in Skribble.',
  inputSchema: { question: z.string() }
}, async ({ question }) => {
  const cfg = await readAiConfig()
  if (!cfg) return { ...text('No API key configured in Skribble (~/.config/skribble/ai.json)'), isError: true }
  const res = await ask({ question, history: [] }, await store.listStored(), cfg)
  return text(JSON.stringify(res, null, 2))
})

server.registerTool('suggest_filing', {
  description: 'Ask the filing agent which other sections this one connects to. Returns proposed [[links]], tags, and (maybe) a verbatim sentence that reads like the takeaway. Nothing is written: show the proposals to the user and call mark_reviewed with what they keep.',
  inputSchema: { note_id: z.string(), section: z.string().optional().describe('exact section heading; omit for a note without headings') }
}, async ({ note_id, section }) => {
  const n = await store.readStored(note_id)
  if (!n) return { ...text(`No note ${note_id}`), isError: true }
  const cfg = await readAiConfig()
  if (!cfg) return { ...text('No API key configured in Skribble (~/.config/skribble/ai.json)'), isError: true }
  const res = await suggestFiling({ noteId: n.id, title: n.title, body: n.body, section }, await store.listStored(), cfg)
  return text(JSON.stringify({ ...res, existing_links: existingLinks(n.body, section) }, null, 2))
})

server.registerTool('mark_reviewed', {
  description: 'Mark a section reviewed: writes "Links: [[…]] · #tag" and "Reviewed: <today>" at the end of the section. Only pass links the user chose to keep. Re-running replaces the previous lines.',
  inputSchema: {
    note_id: z.string(),
    section: z.string().optional().describe('exact section heading; omit for a note without headings'),
    links: z.array(z.string()).default([]).describe('wikilink targets, "Note Title" or "Note Title#Section"'),
    tags: z.array(z.string()).default([])
  }
}, async ({ note_id, section, links, tags }) => {
  const n = await store.readStored(note_id)
  if (!n) return { ...text(`No note ${note_id}`), isError: true }
  const body = applyFiling(n.body, section, { links, tags, reviewed: today() })
  if (body === null) return { ...text(`No section "${section}" in ${note_id}. Sections: ${parseSections(n.body).map((x) => x.heading).join(' | ')}`), isError: true }
  n.body = body
  n.updatedAt = Date.now()
  await store.writeStored(n)
  return text(`Marked reviewed: ${n.title || 'Untitled'}${section ? ' › ' + section : ''}`)
})

server.registerTool('add_insight', {
  description: 'File a one-sentence takeaway as a card in the Insights note, linking back to the section it came from. The sentence must be the user\'s own words, typed or dictated by them; do not generate it.',
  inputSchema: { text: z.string().min(3), note_title: z.string(), section: z.string().optional() }
}, async ({ text: t, note_title, section }) => {
  const id = await addInsight({ text: t, noteTitle: note_title, section })
  return text(`Added to Insights (${id})`)
})

server.registerTool('list_templates', {
  description: 'List note/section templates (markdown with {{date}} placeholders).',
  inputSchema: {}
}, async () => text(JSON.stringify(await listTemplates(), null, 2)))

const transport = new StdioServerTransport()
await server.connect(transport)
