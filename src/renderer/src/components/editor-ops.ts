/** What the side panel can do with the editor. */
export interface EditorOps {
  markdown: () => string
  /** nearest H1/H2 heading at or before the caret */
  currentSection: () => string | undefined
  sections: () => string[]
  /** select the quote in the editor and scroll to it; false if it can't be found */
  highlight: (quote: string) => boolean
  /** replace the whole document from markdown (filing writes lines into a section), keeping the caret */
  replaceMarkdown: (md: string) => void
  scrollToSection: (heading: string) => boolean
}
