# Skribble

A personal, local-first notes app for moving what you write into what you know. Notes are plain markdown files. You write freely; every section you write sits under **Notes** until you **absorb** it: you type the takeaway in your own words and keep the connections that fit. Absorbed sections feed a **Wiki**: a folder of derived pages (people, projects, concepts, topics, decisions) the agent maintains from your notes, in the spirit of [Karpathy's LLM wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). You can search the wiki and chat with it. An MCP server lets other agents do the same.

Three layers, as in that pattern: your notes are the raw sources and are never edited by the model; the wiki is the model's, derived only from what you absorbed; `wiki/WIKI.md` is the schema you both follow. The model proposes connections, you decide; it points at a sentence of yours as a prompt, you type the takeaway.

## Run

```sh
pnpm install
pnpm dev        # launches the app with hot reload
pnpm build      # compiles the app and bundles the MCP server to out/mcp/server.mjs
pnpm package    # builds Skribble.app into dist/
```

To use the same notes on another machine, put `~/Notes` in a synced folder (or a git repo) and point `NOTES_DIR` at it. Config and API keys stay in `~/.config/skribble/` on each machine.

## The loop

1. **Write.** One long note per stream (Meetings, Reflections, Thoughts). A section is an H1 or H2 heading through the next one, with the date in the heading (`Standup  10/13`). H3 headings are labels inside a section. A note with no headings is one unit. Each heading shows a quiet tag: *to absorb* or *absorbed Nov 5*.
2. **Notes.** The left sidebar has four places: **Notes**, **Actions**, **Files** and **Wiki**; ⌘\ hides it. Notes is everything you have written and not yet sent to the wiki, newest first; click a section to edit it, or use its Absorb button to open the absorb screen. Files lists every note, absorbed or not. Every note and section has a copy button that copies it as markdown. Search there reaches every note, absorbed or not, so anything can be reopened for writing.
3. **Absorb.** Left, what you wrote. Right: the takeaway you type, the connections the agent found in your other notes (tap to keep or drop), tags, and one button. ⌘↩ absorbs and moves to the next one; ⌘J / ⌘K skip; Esc goes back. The record lands in the note's frontmatter; the body you wrote is never edited:

   ```yaml
   absorbed:
     - section: Standup 11/04
       date: '2026-11-05'
       links: [Thoughts#Onboarding]
       tags: [onboarding]
   ```

   The takeaway becomes a card in your **Insights** note (one `###` heading per card, linking back to the source), so each insight is its own node in the graph.
4. **Act.** The **Actions** page is the step after capture and synthesis. It is one note the app keeps (`kind: actions` in its frontmatter), with four lists:
   - *Practicing*: lessons you are applying to how you work, shown as cards to glance at before a meeting. They come from your reflections ("Takeaways for next time", "Next time:", "In the future I want to…") or from the "A lesson for next time" box when absorbing.
   - *To do*: tasks a section commits someone to, with the owner kept.
   - *Project changes*: decisions to change a project's scope or priority.
   - *To share*: takeaways owed to someone.

   When you absorb a section, the model files its actions in the background: each one written to read on its own, with a link back to the section, skipping anything already listed or done. Without a key, the "Action Items" / "Next steps" lists and unchecked `- [ ]` todos are filed as written, and "Takeaways for next time" lists become practices. `.actions.json` remembers which sections were filed and their text, so an unchanged section is never filed twice. **Re-extract** replaces the open actions that came from notes; done ones and ones you added stay. "Edit as note" opens the markdown.
5. **Wiki.** After each absorb, the agent folds the section and your takeaway into `~/Notes/wiki/`: it extends or creates pages under `wiki/pages/`, regenerates `wiki/index.md`, and appends to `wiki/log.md`. This runs in the background; absorbing never waits on the model. The Wiki view is a chat: ask it anything and the answer cites the page or note section it came from, clickable. Pages are listed under Wiki in the sidebar, grouped by kind. Notes you haven't absorbed are never used for answers. Settings (⌘,) shows how many absorbed sections are waiting and lets you update or rebuild the wiki.

## Shortcuts

| Action | Keys |
| --- | --- |
| New note | ⌘N |
| Delete note | ⌘⌫ |
| Search | ⌘F |
| Notes / Wiki / Files / Actions | ⌘1 / ⌘2 / ⌘3 / ⌘4 |
| Hide / show sidebar | ⌘\ |
| Settings | ⌘, |
| Back | ⌘[ or Esc |
| Absorb (on the absorb screen) | ⌘↩ |
| Next / previous to absorb | ⌘J / ⌘K |
| Bold / italic / strikethrough | ⌘B / ⌘I / ⇧⌘X |
| Title / Heading / Body | ⇧⌘T / ⇧⌘H / ⇧⌘B |
| Todo list | ⇧⌘L |
| Insert Meeting / Reflection template | ⇧⌘M / ⇧⌘R |

Markdown shortcuts work too: `# ` headings, `- ` bullets, `[ ] ` todos.

Autocorrect fixes a misspelled word when you finish it, using the macOS spellchecker. Backspace right after puts back what you typed. Capitalized names, acronyms, code-like words and words that appear in two or more of your notes are left alone. Right-click a word underlined in red for suggestions or Learn Spelling. Turn it off in Settings.

## Where notes live

Each note is a markdown file with frontmatter in `~/Notes` (override with `NOTES_DIR`). Templates are in `~/Notes/.templates/*.md`. The wiki is `~/Notes/wiki/` (`WIKI.md`, `index.md`, `log.md`, `pages/*.md`, all plain markdown; `.ingested.json` tracks which absorbed sections are in). File → Reveal Notes Folder / Reveal Wiki Folder open them in Finder. There are no folders in the app itself.

## Graph

Links: `[[Note]]` or `[[Note#Section]]` in the text, plus the links you keep when absorbing. Tags: `#tag` in the text, plus tags kept when absorbing. One graph node per section, carrying links, backlinks, tags and the absorbed date.

## AI

Set the key in Settings (⌘,). The wiki, connections and chat take either a Gemini API key from Google AI Studio (`AIza…`, default model `gemini-3.8-flash`) or an OpenRouter key (`sk-or-v1-…`, default model `google/gemini-3.8-flash`). The app detects which you pasted. Key and model live in `~/.config/skribble/ai.json`; edit `model` there to switch. The app asks for a key the first time you need it. Absorbing works without a key; you just don't get suggested connections.

## MCP server

```sh
pnpm build
claude mcp add skribble -- node /path/to/skribble/out/mcp/server.mjs
```

For Claude Desktop, add the same command under `mcpServers` in its config. Tools: `list_notes`, `search_notes`, `read_note`, `read_section`, `create_note`, `update_note`, `append_to_note`, `append_section`, `list_templates`, `get_graph`, `list_inbox` (not yet absorbed), `list_absorbed`, `list_wiki`, `read_wiki_page`, `wiki_log`, `search_wiki`, `ask_wiki`, `suggest_connections`, `absorb`, `add_insight`, `list_actions`, `add_practice`. The absorb tools follow the same rule as the app: `suggest_connections` proposes, `absorb` records only what the user kept and then updates the wiki, `add_insight` files words the user wrote.

## Layout

- `src/main/` Electron main process: window, menu, IPC, Apple Notes import
- `src/preload/` the `window.notes` bridge
- `src/renderer/src/` React UI: `Sidebar`, `NotesView`, `ActionsView`, `FilesView`, `WikiChat`, `Absorb` screen, `WikiPage` reader, `Settings`, `Editor` (TipTap, with heading tags)
- `src/core/` shared logic: markdown ↔ HTML, store, sections, graph, `absorb`, `inbox`, `insights`, `actions`, `wiki` (pages, index, log), templates, `ai/` (connections, actions, wiki ingest and ask agents)
- `src/mcp/` the stdio MCP server
