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
}

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
}

export interface InsightRequest {
  text: string
  noteTitle: string
  section?: string
}

/** Chat over the brain: absorbed units and insight cards only. */
export interface AskTurn { role: 'user' | 'assistant'; content: string }

export interface AskRequest {
  question: string
  history: AskTurn[]
}

export interface AskSource {
  nodeId: string
  noteId: string
  section?: string
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
  /** absorb a unit; returns the note as re-read from disk */
  absorb: (req: AbsorbRequest) => Promise<Note>
  onMenu: (cb: (action: string) => void) => () => void
  onNotesChanged: (cb: () => void) => () => void
}
