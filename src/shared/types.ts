export interface AppleNoteSummary {
  id: string
  name: string
  folder: string
  modified: string
  size: number
}

/** A section (or a headingless note) that has been absorbed: taken from the inbox into your brain. Lives in frontmatter; the body is never touched. */
export interface Absorbed {
  /** section heading; absent for a note with no headings */
  section?: string
  /** ISO date */
  date: string
  /** wikilink targets, "Note Title" or "Note Title#Section" */
  links: string[]
  tags: string[]
}

export interface Note {
  id: string
  title: string
  /** TipTap HTML in the renderer; stored on disk as markdown */
  content: string
  /** plain-text preview, derived */
  preview: string
  /** full plain text for search, derived in the main process */
  text: string
  pinned: boolean
  tags: string[]
  absorbed: Absorbed[]
  createdAt: number
  updatedAt: number
  /** a note the app maintains: 'actions' is the Actions note */
  kind?: NoteKind
}

export type NoteKind = 'actions'

/** A node is a section of a note (or the note's preamble before its first heading). */
export interface GraphNode {
  /** `${noteId}` for the preamble, `${noteId}#${section slug}` for a section */
  id: string
  noteId: string
  noteTitle: string
  /** section heading, absent for the preamble */
  section?: string
  level: number
  date?: string
  tags: string[]
  /** node ids this node links to via [[Note]] or [[Note#Section]], in the text or in its absorbed entry */
  links: string[]
  /** node ids linking here */
  backlinks: string[]
  /** ISO date the unit was absorbed */
  absorbed?: string
  /** first ~140 chars of the section's own text */
  preview: string
  /** note's updatedAt, for ordering the inbox */
  updatedAt: number
  /** this node is a card in the Insights note */
  insight?: boolean
  /** this node belongs to a note the app maintains (Actions); never a unit to absorb */
  system?: boolean
}

export type WikiPageKind = 'person' | 'project' | 'concept' | 'topic' | 'decision'

/** A page in the derived wiki (NOTES_DIR/wiki/pages). Written by the agent, never by hand in the app. */
export interface WikiPage {
  slug: string
  title: string
  kind: WikiPageKind
  /** one line for the index */
  summary: string
  /** "Note Title#Section" refs this page draws on */
  sources: string[]
  /** ISO date */
  updated: string
  /** markdown */
  body: string
}

export interface WikiStatus {
  /** absorbed units not yet folded into the wiki */
  pending: number
  /** a rebuild/ingest is running */
  busy: boolean
  lastError?: string
}

export interface Template {
  name: string
  body: string
}

export interface AiStatus { configured: boolean; model?: string }

/** Ask the agent where a section connects in the brain. */
export interface SuggestRequest {
  noteId: string
  /** heading of the section; omit for a note without headings */
  section?: string
}

export interface Connection {
  /** wikilink target, "Note Title" or "Note Title#Section" */
  target: string
  /** human label, "Note › Section" */
  label: string
  /** why the agent thinks they connect */
  why: string
}

export interface Suggestion {
  links: Connection[]
  tags: string[]
  /** a verbatim sentence from the section the agent thinks is the takeaway; shown as a prompt, never inserted */
  insightQuote?: string
  /** labels of the sections the agent compared against */
  context: string[]
  model: string
}

/** Absorb a unit: record links/tags/date in frontmatter and optionally file a typed takeaway. */
export interface AbsorbRequest {
  noteId: string
  section?: string
  links: string[]
  tags: string[]
  /** the takeaway in the user's own words; becomes an insight card */
  insight?: string
  /** something the user is trying to do better; added to Practicing in the Actions note */
  practice?: string
}

/** What acting on a note can mean: a task, a change to a project's scope or priority, or a takeaway to pass on. */
export type ActionKind = 'todo' | 'change' | 'share'
export type ActionList = 'practices' | ActionKind

/** One line in the Actions note. */
export interface ActionItem {
  text: string
  done: boolean
  kind: ActionKind
  /** wikilink target of the section it came from, "Note Title#Section" */
  source?: string
}

/** The Actions note, parsed: what you are practicing, and what you are acting on. */
export interface ActionsState {
  noteId: string
  practices: string[]
  items: ActionItem[]
}

export type ActionsEdit =
  | { op: 'add'; list: ActionList; text: string }
  | { op: 'remove'; list: ActionList; text: string }
  | { op: 'toggle'; text: string }
  | { op: 'clear-done' }
  /** drop every open item filed from a note and extract them all again */
  | { op: 'rebuild' }

export interface InsightRequest {
  text: string
  noteTitle: string
  section?: string
}

/** Chat over the wiki: its pages, absorbed units and insight cards. The unabsorbed notes are out of scope. */
export interface AskTurn { role: 'user' | 'assistant'; content: string }

export interface AskRequest {
  question: string
  history: AskTurn[]
}

export interface AskSource {
  /** graph node id, or "wiki:<slug>" for a wiki page */
  nodeId: string
  noteId?: string
  section?: string
  /** wiki page slug when the source is a page */
  page?: string
  label: string
}

export interface AskResult {
  reply: string
  sources: AskSource[]
  model: string
}

export interface NotesApi {
  listNotes: () => Promise<Note[]>
  /** returns the note as re-read from disk (derived fields refreshed) */
  saveNote: (note: Note) => Promise<Note>
  deleteNote: (id: string) => Promise<void>
  getGraph: () => Promise<GraphNode[]>
  notesDir: () => Promise<string>
  listTemplates: () => Promise<Template[]>
  saveTemplate: (t: Template) => Promise<void>
  deleteTemplate: (name: string) => Promise<void>
  appleNotesList: () => Promise<AppleNoteSummary[]>
  appleNotesImport: (ids: string[]) => Promise<number>
  aiStatus: () => Promise<AiStatus>
  aiConfigure: (cfg: { apiKey: string; model?: string }) => Promise<AiStatus>
  aiSuggest: (req: SuggestRequest) => Promise<Suggestion>
  aiAsk: (req: AskRequest) => Promise<AskResult>
  /** absorb a unit; returns the note as re-read from disk. The wiki update runs in the background. */
  absorb: (req: AbsorbRequest) => Promise<Note>
  wikiPages: () => Promise<WikiPage[]>
  wikiPage: (slug: string) => Promise<WikiPage | null>
  wikiStatus: () => Promise<WikiStatus>
  /** fold every absorbed unit not yet in the wiki (or all of them with force) */
  wikiRebuild: (force?: boolean) => Promise<number>
  wikiLog: () => Promise<string>
  actions: () => Promise<ActionsState>
  editActions: (edit: ActionsEdit) => Promise<ActionsState>
  onWikiChanged: (cb: () => void) => () => void
  onMenu: (cb: (action: string) => void) => () => void
  onNotesChanged: (cb: () => void) => () => void
  /** the system spellchecker (macOS), for autocorrect */
  spell: { misspelled: (word: string) => boolean; suggestions: (word: string) => string[] }
}
