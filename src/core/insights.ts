/**
 * The Insights note: one H3 card per takeaway, each a graph node that links back to where it came from.
 * The text is always typed by the user; this only files it.
 */
import { randomUUID } from 'crypto'
import type { InsightRequest } from '../shared/types'
import * as store from './store'
import { today } from './filing'

const TITLES = ['insights', 'learnings', 'insights & learnings', 'insights and learnings', 'key learnings']

export async function findInsightsNote(): Promise<store.StoredNote | undefined> {
  const notes = await store.listStored()
  for (const t of TITLES) { const n = notes.find((x) => x.title.trim().toLowerCase() === t); if (n) return n }
  return undefined
}

export function insightCard(req: InsightRequest, date = today()): string {
  const text = req.text.trim().replace(/\s+/g, ' ').replace(/^#+\s*/, '')
  const title = req.noteTitle.trim() || 'Untitled'
  const from = req.section ? `[[${title}#${req.section}]]` : `[[${title}]]`
  return `### ${text}\nFrom ${from} · ${date}\n`
}

export async function addInsight(req: InsightRequest): Promise<string> {
  if (!req.text.trim()) throw new Error('Insight is empty')
  const now = Date.now()
  const existing = await findInsightsNote()
  const n = existing ?? { id: randomUUID(), title: 'Insights', body: '', pinned: true, tags: [], createdAt: now, updatedAt: now }
  const body = n.body.replace(/\s+$/, '')
  n.body = (body ? body + '\n\n' : '') + insightCard(req)
  n.updatedAt = now
  await store.writeStored(n)
  return n.id
}
