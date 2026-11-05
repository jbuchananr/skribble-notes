# Skribble

A personal, local-first notes app for turning raw notes into things you have actually thought through. Notes are plain markdown files. You write freely; every section you write lands in a **review pile**; you file each one by choosing which other notes it connects to and typing the takeaway in your own words. Reviewed sections become your published thinking, which you can search and chat over. An MCP server lets other agents do the same.

The model never writes your notes. It proposes links, you decide; it offers a sentence of yours as a prompt, you type the takeaway.

## Run

```sh
pnpm install
pnpm dev        # launches the app with hot reload
pnpm build      # compiles the app and bundles the MCP server to out/mcp/server.mjs
pnpm package    # builds Skribble.app into dist/
```

To use the same notes on another machine, put `~/Notes` in a synced folder (or a git repo) and point `NOTES_DIR` at it. Config and API keys stay in `~/.config/skribble/` on each machine.

## The loop

1. **Write.** One long note per stream (Meetings, Reflections, Thoughts). A section is an H1 or H2 heading through the next one, with the date in the heading (`Standup  10/13`). H3 headings are labels inside a section. A note with no headings is one unit.
2. **Review pile.** The home screen opens on every section you have not reviewed yet, newest first. Click one and it opens on that section with the File tab ready.
3. **File.** *Suggest links* asks where this section connects in your other notes; keep the ones that fit. Optionally type a one-sentence takeaway. *Mark reviewed* appends two lines to the section and nothing else:

   ```
   Links: [[Thoughts#Onboarding]] · #onboarding

   Reviewed: 2026-11-05
   ```

   The takeaway becomes a card in your **Insights** note (one `###` heading per card, linking back to the source), so each insight is its own node in the graph.
4. **Reviewed.** The Reviewed view lists filed sections and has a chat box that answers only from them and from your insight cards, with citations you can click. Unreviewed notes are never used for answers.

## Shortcuts

| Action | Keys |
| --- | --- |
| New note | ⌘N |
| Delete note | ⌘⌫ |
| Search | ⌘F |
| Review pile / Reviewed view | ⌘1 / ⌘2 |
| Back to notes | ⌘[ or Esc |
| File & review panel | ⇧⌘F |
| Outline, links & tags panel | ⇧⌘I |
| Bold / italic / strikethrough | ⌘B / ⌘I / ⇧⌘X |
| Title / Heading / Body | ⇧⌘T / ⇧⌘H / ⇧⌘B |
| Todo list | ⇧⌘L |
| Insert Meeting / Reflection template | ⇧⌘M / ⇧⌘R |

Markdown shortcuts work too: `# ` headings, `- ` bullets, `[ ] ` todos.

## Where notes live

Each note is a markdown file with frontmatter in `~/Notes` (override with `NOTES_DIR`). Templates are in `~/Notes/.templates/*.md`. File → Reveal Notes Folder opens it in Finder. There are no folders in the app; the pile and the reviewed list are the organization.

## Graph

Links: `[[Note]]` or `[[Note#Section]]`. Tags: `#tag`. One graph node per section, carrying its links, backlinks, tags and reviewed date. The Context tab in the editor shows the outline (with a check on reviewed sections), links and backlinks, and tags.

## AI

Link suggestions and chat take either a Gemini API key from Google AI Studio (`AIza…`, default model `gemini-3.8-flash`) or an OpenRouter key (`sk-or-v1-…`, default model `google/gemini-3.8-flash`). The app detects which you pasted. Key and model live in `~/.config/skribble/ai.json`; edit `model` there to switch. The app asks for a key the first time you use either feature. Everything works without a key except suggestions and chat.

## MCP server

```sh
pnpm build
claude mcp add skribble -- node /path/to/skribble/out/mcp/server.mjs
```

For Claude Desktop, add the same command under `mcpServers` in its config. Tools: `list_notes`, `search_notes`, `read_note`, `read_section`, `create_note`, `update_note`, `append_to_note`, `append_section`, `list_templates`, `get_graph`, `list_unreviewed`, `list_reviewed`, `search_reviewed`, `ask_reviewed`, `suggest_filing`, `mark_reviewed`, `add_insight`. The filing tools follow the same rule as the app: `suggest_filing` proposes, `mark_reviewed` writes only what the user kept, `add_insight` files words the user wrote.

## Layout

- `src/main/` Electron main process: window, menu, IPC, Apple Notes import
- `src/preload/` the `window.notes` bridge
- `src/renderer/src/` React UI: `Home` (review pile, reviewed view with `Ask`, all notes), `Editor` (TipTap), `ContextPanel` with `FileSection`
- `src/core/` shared logic: markdown ↔ HTML, store, sections, graph, `filing`, `review`, `insights`, templates, `ai/` (filing agent, ask agent)
- `src/mcp/` the stdio MCP server
