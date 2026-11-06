/** Titles that make a note the Insights note. No imports, so the renderer can use it. */
export const INSIGHT_TITLES = new Set(['insights', 'learnings', 'insights & learnings', 'insights and learnings', 'key learnings'])
export const isInsightsNote = (n: { title: string }) => INSIGHT_TITLES.has(n.title.trim().toLowerCase())
