/**
 * Skribble MCP server (stdio). Exposes your markdown notes, the link graph, the inbox and the
 * absorb actions to any MCP client: Claude, Claude Code, ChatGPT, Cursor, custom agents.
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
import { setAbsorbed, getAbsorbed, today } from '../core/absorb'
import { inbox, brain } from '../core/inbox'
import { addInsight } from '../core/insights'
import * as actions from '../core/actions'
import { readAiConfig } from '../core/ai/config'
import { suggestConnections } from '../core/ai/suggest'
import { ask, wikiPassages, retrieve } from '../core/ai/ask'
import * as wiki from '../core/wiki'
import { ingest, sourceRef } from '../core/ai/wiki'
import { listTemplates, renderTemplate } from '../core/templates'
import { mdToText } from '../core/markdown'
import { NOTES_DIR } from '../core/paths'
import { syncOnce } from '../core/cloud/sync'
import { readCloudConfig, DEVICE_ID } from '../core/cloud/config'

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
  const pending = mine.filter((m) => !m.absorbed && m.level > 0 && m.level <= 2).map((m) => m.section)
  if (pending.length) out += `in inbox (not absorbed yet): ${pending.join(' | ')}\n`
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
  description: 'Read a note as markdown, with its links, backlinks, sections, and which sections are still in the inbox.',
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
  await store.writeStored({ id, title, body, pinned: false, tags: [], absorbed: [], createdAt: now, updatedAt: now })
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
  description: 'The knowledge graph. One node per section of a note (long notes are made of dated sections like "Standup 10/13"), each with tags, [[links]], backlinks and the date it was absorbed. Node ids are "<noteId>" or "<noteId>#<section-slug>".',
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

// ---------- inbox & brain ----------
server.registerTool('list_inbox', {
  description: 'The inbox: sections (or whole notes without headings) the user has written but not yet absorbed, newest first. Absorbing is the user\'s act of deciding what a section means and where it connects; help them, do not do it for them.',
  inputSchema: { limit: z.number().int().min(1).max(200).default(30) }
}, async ({ limit }) => {
  const q = inbox(buildGraph(await store.listStored()))
  return text(JSON.stringify(q.slice(0, limit).map((n) => ({ note_id: n.noteId, note: n.noteTitle || 'Untitled', section: n.section, date: n.date, preview: n.preview })), null, 2))
})

server.registerTool('list_absorbed', {
  description: 'Absorbed sections and insight cards, most recent first. This is the user\'s settled thinking; prefer it over unabsorbed notes when answering questions.',
  inputSchema: { limit: z.number().int().min(1).max(200).default(30) }
}, async ({ limit }) => {
  const units = brain(buildGraph(await store.listStored()))
  return text(JSON.stringify(units.slice(0, limit).map((n) => ({ node_id: n.id, note_id: n.noteId, note: n.noteTitle || 'Untitled', section: n.section, absorbed: n.absorbed, insight: n.insight || undefined, tags: n.tags, preview: n.preview })), null, 2))
})

server.registerTool('search_wiki', {
  description: 'Find the wiki pages, absorbed sections and insight cards most relevant to a question, with their full text. Use this to answer from the user\'s settled thinking without calling a model.',
  inputSchema: { query: z.string(), limit: z.number().int().min(1).max(20).default(6) }
}, async ({ query, limit }) => {
  const hits = retrieve(query, [], wikiPassages(await store.listStored(), await wiki.listPages()), limit)
  return text(JSON.stringify(hits.map((p) => ({ id: p.id, kind: p.kind, note_id: p.noteId, page: p.page, label: p.label, updated: p.absorbed, text: p.text })), null, 2))
})

server.registerTool('ask_wiki', {
  description: 'Ask a question answered only from the user\'s wiki: derived pages, absorbed sections and insight cards, with citations. Needs the API key configured in Skribble.',
  inputSchema: { question: z.string() }
}, async ({ question }) => {
  const cfg = await readAiConfig()
  if (!cfg) return { ...text('No API key configured in Skribble (~/.config/skribble/ai.json)'), isError: true }
  const res = await ask({ question, history: [] }, await store.listStored(), await wiki.listPages(), cfg)
  return text(JSON.stringify(res, null, 2))
})

server.registerTool('suggest_connections', {
  description: 'Ask the agent which other sections this one connects to. Returns proposed [[links]], tags, and (maybe) a verbatim sentence that reads like the takeaway. Nothing is written: show the proposals to the user and call absorb with what they keep.',
  inputSchema: { note_id: z.string(), section: z.string().optional().describe('exact section heading; omit for a note without headings') }
}, async ({ note_id, section }) => {
  const n = await store.readStored(note_id)
  if (!n) return { ...text(`No note ${note_id}`), isError: true }
  const cfg = await readAiConfig()
  if (!cfg) return { ...text('No API key configured in Skribble (~/.config/skribble/ai.json)'), isError: true }
  const res = await suggestConnections({ noteId: n.id, section }, await store.listStored(), cfg)
  return text(JSON.stringify({ ...res, already: getAbsorbed(n.absorbed, section) }, null, 2))
})

server.registerTool('absorb', {
  description: 'Absorb a section into the brain: records today\'s date, the links and tags the user kept, in the note\'s frontmatter (the body is never edited). Optionally files a takeaway as an insight card; that sentence must be the user\'s own words. Re-running replaces the previous entry.',
  inputSchema: {
    note_id: z.string(),
    section: z.string().optional().describe('exact section heading; omit for a note without headings'),
    links: z.array(z.string()).default([]).describe('wikilink targets, "Note Title" or "Note Title#Section"'),
    tags: z.array(z.string()).default([]),
    insight: z.string().optional().describe('one-sentence takeaway written by the user')
  }
}, async ({ note_id, section, links, tags, insight }) => {
  const n = await store.readStored(note_id)
  if (!n) return { ...text(`No note ${note_id}`), isError: true }
  if (section && !parseSections(n.body).some((x) => x.heading === section)) return { ...text(`No section "${section}" in ${note_id}. Sections: ${parseSections(n.body).map((x) => x.heading).join(' | ')}`), isError: true }
  n.absorbed = setAbsorbed(n.absorbed, { section, date: today(), links, tags })
  n.updatedAt = Date.now()
  await store.writeStored(n)
  if (insight?.trim()) await addInsight({ text: insight, noteTitle: n.title || 'Untitled', section })
  const cfg = await readAiConfig()
  const filed = await actions.fileActionItems(n, section, cfg, insight?.trim() || undefined).catch(() => 0)
  let wikiNote = filed ? ` Filed ${filed} action(s).` : ''
  if (cfg) {
    try {
      const entry = n.absorbed.find((a) => (a.section ?? '') === (section ?? ''))!
      const touched = await ingest({ note: n, section, entry, insight: insight?.trim() || undefined }, cfg)
      await wiki.markIngested(sourceRef(n, section))
      wikiNote += touched.length ? ` Wiki pages touched: ${touched.join(', ')}.` : ' Wiki: nothing to add.'
    } catch (e) { wikiNote += ` Wiki update failed: ${(e as Error).message}` }
  } else wikiNote += ' Wiki not updated (no API key configured).'
  return text(`Absorbed: ${n.title || 'Untitled'}${section ? ' › ' + section : ''}${insight?.trim() ? ' (+ insight card)' : ''}.${wikiNote}`)
})

server.registerTool('list_wiki', {
  description: 'The wiki index: derived pages (people, projects, concepts, topics, decisions) the agent maintains from absorbed notes, each with a one-line summary.',
  inputSchema: {}
}, async () => text(JSON.stringify((await wiki.listPages()).map((p) => ({ slug: p.slug, kind: p.kind, title: p.title, summary: p.summary, updated: p.updated, sources: p.sources })), null, 2)))

server.registerTool('read_wiki_page', {
  description: 'Read one wiki page as markdown, with the note sections it cites.',
  inputSchema: { slug: z.string() }
}, async ({ slug }) => {
  const p = await wiki.readPage(slug)
  if (!p) return { ...text(`No wiki page "${slug}"`), isError: true }
  return text(`# ${p.title}\nkind: ${p.kind}\nupdated: ${p.updated}\nsources: ${p.sources.join('; ')}\n\n${p.body}`)
})

server.registerTool('wiki_log', {
  description: 'Recent entries from the wiki log (ingests and rebuilds).',
  inputSchema: { limit: z.number().int().min(1).max(200).default(30) }
}, async ({ limit }) => text(await wiki.readLog(limit)))

server.registerTool('sync_cloud', {
  description: 'Sync the notes folder with the cloud database (pull other machines\' changes, push local ones). Needs a connection string in ~/.config/skribble/cloud.json or DATABASE_URL.',
  inputSchema: {}
}, async () => {
  if (!(await readCloudConfig())) return text('Cloud sync is not configured. Paste a Postgres connection string in Skribble › Settings › Cloud.')
  const r = await syncOnce()
  return text(`Synced as ${DEVICE_ID}: pulled ${r.pulled}, pushed ${r.pushed}, deleted ${r.deleted}, conflicts ${r.conflicts}`)
})

server.registerTool('add_insight', {
  description: 'File a one-sentence takeaway as a card in the Insights note, linking back to the section it came from. The sentence must be the user\'s own words, typed or dictated by them; do not generate it.',
  inputSchema: { text: z.string().min(3), note_title: z.string(), section: z.string().optional() }
}, async ({ text: t, note_title, section }) => {
  const id = await addInsight({ text: t, noteTitle: note_title, section })
  return text(`Added to Insights (${id})`)
})

server.registerTool('list_actions', {
  description: 'The Actions note. "practices" are lessons the user is actively applying to how they work. "items" are what they are acting on, filed automatically from absorbed sections: kind "todo" (tasks), "change" (changes to a project\'s scope or priority) or "share" (takeaways to pass on), each with the section it came from.',
  inputSchema: { include_done: z.boolean().default(false) }
}, async ({ include_done }) => {
  const s = await actions.readActions()
  return text(JSON.stringify({ practices: s.practices, items: include_done ? s.items : s.items.filter((i) => !i.done) }, null, 2))
})

server.registerTool('add_practice', {
  description: 'Add a practice to the Actions note: a lesson the user is actively applying to how they work.',
  inputSchema: { text: z.string().min(3) }
}, async ({ text: t }) => {
  const s = await actions.editActions({ op: 'add', list: 'practices', text: t })
  return text(`Practicing now: ${s.practices.join(' | ')}`)
})

server.registerTool('list_templates', {
  description: 'List note/section templates (markdown with {{date}} placeholders).',
  inputSchema: {}
}, async () => text(JSON.stringify(await listTemplates(), null, 2)))

await store.migrateMarkers()
await wiki.ensureWiki()
const transport = new StdioServerTransport()
await server.connect(transport)
