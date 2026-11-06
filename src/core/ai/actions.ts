/**
 * The actions agent: turn one absorbed section into the actions it commits to, written so each reads on
 * its own, and leave out anything already on the list. This is the "act" step after capture and synthesis.
 */
import type { ActionList } from '../../shared/types'
import { chat, type ChatMessage } from './openrouter'
import type { AiConfig } from './config'

const SECTION_CAP = 6000
const MAX_ACTIONS = 10

export interface ExtractInput {
  noteTitle: string
  section?: string
  text: string
  /** the takeaway the user typed when absorbing, if any */
  takeaway?: string
  /** what is already on the list, open items and practices */
  existing: { list: ActionList; text: string }[]
}

export interface Extracted { list: ActionList; text: string }

const SYSTEM = `You keep someone's list of actions: what they act on after a meeting or a reflection. You get one section of their notes and the actions already on their list. Return the new actions this section commits them to.

Kinds:
- "todo": a concrete task someone committed to. Keep the owner when the notes name one ("Sagar: send the tool list and skills").
- "change": a decision to change a project's definition, scope or priority ("Move bio ID mapping ahead of the KG work for the QC demo").
- "share": a takeaway to send or present to someone, when the notes say to share it or a follow-up is clearly owed.
- "practice": a lesson the author wants to carry into how they work: "takeaways for next time", "next time:", "in the future I want to…", or what to do instead of something that went badly. Write it as a short reminder to glance at before the next meeting ("Before external meetings, map who decides what and what each person cares about"). Only the author's own lessons, never other people's tasks.

Rules:
- Only what the section states or clearly decides. Never invent work.
- Each action must read on its own months later: imperative, under 16 words, naming the project, system or person it is about. Fold sub-bullets into their parent. Fix obvious typos.
- Drop fragments the section gives no way to make concrete.
- If an action is already covered by one in EXISTING, even worded differently or marked (done), leave it out.
- 0-${MAX_ACTIONS} actions. An empty list is a fine answer.

Respond ONLY with JSON: { "actions": [{ "kind": "todo", "text": "…" }] }`

export function buildExtractMessages(input: ExtractInput): ChatMessage[] {
  const packet = [
    `Today: ${new Date().toISOString().slice(0, 10)}`,
    `NOTE: ${input.noteTitle || 'Untitled'}`,
    input.section ? `SECTION: ${input.section}` : 'SECTION: whole note',
    input.text.trim().slice(0, SECTION_CAP),
    input.takeaway ? `\nTHEIR TAKEAWAY: ${input.takeaway}` : '',
    '',
    input.existing.length ? 'EXISTING:' : 'EXISTING: none yet.',
    ...input.existing.map((e, i) => `${i + 1}. [${e.list}] ${e.text}`)
  ].join('\n')
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: packet }]
}

const KINDS: Record<string, ActionList> = { todo: 'todo', change: 'change', share: 'share', practice: 'practices', practices: 'practices' }

export function parseExtracted(raw: string): Extracted[] {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  let data: { actions?: unknown }
  try { data = JSON.parse(text) } catch { throw new Error('Model returned something other than JSON') }
  const out: Extracted[] = []
  for (const a of Array.isArray(data.actions) ? data.actions : []) {
    if (!a || typeof a !== 'object') continue
    const r = a as Record<string, unknown>
    const list = KINDS[String(r.kind ?? '').toLowerCase()]
    const t = String(r.text ?? '').replace(/\s+/g, ' ').trim()
    if (list && t) out.push({ list, text: t })
  }
  return out.slice(0, MAX_ACTIONS)
}

export async function extractActions(input: ExtractInput, cfg: AiConfig): Promise<Extracted[]> {
  const raw = await chat(cfg, buildExtractMessages(input), { json: true, maxTokens: 900 })
  return parseExtracted(raw)
}
