export interface AppleNoteSummary {
  id: string
  name: string
  folder: string
  modified: string
  size: number
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
  /** node ids this node links to via [[Note]] or [[Note#Section]] */
  links: string[]
  /** node ids linking here */
  backlinks: string[]
  /** ISO date of the "Reviewed:" line, once the section has been synthesized and filed */
  reviewed?: string
  /** first ~140 chars of the section's own text */
  preview: string
  /** note's updatedAt, for ordering the review pile */
  updatedAt: number
}

export interface Template {
  name: string
  body: string
}

export interface AiStatus { configured: boolean; model?: string }

/** Ask the filing agent where a section connects in the graph. */
export interface FileRequest {
  noteId: string
  title: string
  /** current markdown body (editor may be ahead of disk) */
  body: string
  /** heading of the section to file; omit for a note without headings */
  section?: string
}

export interface FileLink {
  /** wikilink target, "Note Title" or "Note Title#Section" */
  target: string
  /** human label, "Note › Section" */
  label: string
  /** why the agent thinks they connect */
  why: string
}

export interface FileResult {
  links: FileLink[]
  tags: string[]
  /** a verbatim sentence from the section the agent thinks is the takeaway; shown as a prompt, never inserted */
  insightQuote?: string
  /** labels of the sections the agent compared against */
  context: string[]
  model: string
}

/** What gets written into the section when it is marked reviewed. */
export interface Filing {
  links: string[]
  tags: string[]
  /** ISO date */
  reviewed: string
}

export interface InsightRequest {
  /** the takeaway, typed by the user */
  text: string
  noteTitle: string
  section?: string
}

/** Chat over reviewed notes and insight cards only. */
export interface AskTurn { role: 'user' | 'assistant'; content: string }

export interface AskRequest {
  question: string
  history: AskTurn[]
}

export interface AskSource {
  nodeId: string
  noteId: string
  label: string
}

export interface AskResult {
  reply: string
  /** the reviewed sections the answer drew on */
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
  aiFile: (req: FileRequest) => Promise<FileResult>
  aiAsk: (req: AskRequest) => Promise<AskResult>
  /** append a one-sentence insight card to the Insights note; returns that note's id */
  insightAdd: (req: InsightRequest) => Promise<string>
  onMenu: (cb: (action: string) => void) => () => void
  onNotesChanged: (cb: () => void) => () => void
}
