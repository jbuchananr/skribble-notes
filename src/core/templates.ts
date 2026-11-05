import { promises as fs } from 'fs'
import { join } from 'path'
import type { Template } from '../shared/types'
import { NOTES_DIR } from './paths'

export const TEMPLATES_DIR = join(NOTES_DIR, '.templates')

export const DEFAULT_TEMPLATES: Template[] = [
  {
    name: 'Meeting',
    body: `## Meeting name  {{date}}

### Meeting objective / decisions we need to make

-

### Takeaways / learnings / decisions

-

### Open questions

-

### Action items

- [ ]

### Reflection

**What changed my understanding?**

-

**What does that change about my work?**

-

**What should I do differently next time?**

-

---
`
  },
  {
    name: 'Reflection',
    body: `## Reflection  {{date}}

**Biggest takeaway:** what became clearer or changed my thinking?

-

**Why it matters:** what does this mean for my work or decisions?

-

**Next step:** what will I do with what I learned?

-

**Effective**

-

**Ineffective**

-

---
`
  }
]

export async function ensureTemplates() {
  try { await fs.access(TEMPLATES_DIR); return } catch { /* create */ }
  await fs.mkdir(TEMPLATES_DIR, { recursive: true })
  for (const t of DEFAULT_TEMPLATES) await fs.writeFile(join(TEMPLATES_DIR, `${t.name}.md`), t.body, 'utf8')
}

export async function listTemplates(): Promise<Template[]> {
  await ensureTemplates()
  const files = (await fs.readdir(TEMPLATES_DIR)).filter((f) => f.endsWith('.md')).sort()
  const out: Template[] = []
  for (const f of files) out.push({ name: f.replace(/\.md$/, ''), body: await fs.readFile(join(TEMPLATES_DIR, f), 'utf8') })
  return out
}

export async function saveTemplate(t: Template) {
  await ensureTemplates()
  const name = t.name.replace(/[/\\:]/g, '-').trim() || 'Template'
  await fs.writeFile(join(TEMPLATES_DIR, `${name}.md`), t.body, 'utf8')
}

export async function deleteTemplate(name: string) {
  await fs.rm(join(TEMPLATES_DIR, `${name}.md`), { force: true })
}

export { renderTemplate } from './template-render'
