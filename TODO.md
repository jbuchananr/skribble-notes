# TODO

- [ ] **Clip from anywhere.** A system-wide shortcut (e.g. ⌃⌥S) that takes the currently highlighted text in any app and drops it into a Skribble note. Likely shape: Electron `globalShortcut` + simulate ⌘C (or read the selection via the macOS Services menu / Accessibility API), then append to a configurable note ("Clips" by default) as a new dated section with the source app and URL when available. The new section lands under Notes like anything else, ready to absorb. Needs Accessibility permission on macOS; the Services-menu route avoids that but is less immediate.
- [ ] Wiki lint pass: contradictions, stale claims, orphan pages, missing cross-references (the gist's "lint" operation).
- [ ] Verify the Gemini (AI Studio) endpoint with a live key; only typechecked so far.
- [ ] Embeddings for retrieval once the wiki passes a few hundred pages; token overlap is fine until then.
