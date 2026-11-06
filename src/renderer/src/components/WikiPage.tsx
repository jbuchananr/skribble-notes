import { useEffect, useState } from 'react'
import type { WikiPage as Page } from '../../../shared/types'
import { mdToHtml } from '../../../core/markdown'
import { BookOpen } from './Icons'

interface Props {
  slug: string
  onBack: () => void
  /** open a cited "Note#Section" source */
  onOpenSource: (ref: string) => void
  onOpenPage: (slug: string) => void
}

const KIND_LABEL: Record<Page['kind'], string> = { person: 'Person', project: 'Project', concept: 'Concept', topic: 'Topic', decision: 'Decision' }

/** Read-only view of a wiki page. Pages are the agent's; edit them in the wiki folder if you must. */
export function WikiPageView({ slug, onBack, onOpenSource, onOpenPage }: Props) {
  const [page, setPage] = useState<Page | null | undefined>(undefined)
  useEffect(() => { window.notes.wikiPage(slug).then(setPage) }, [slug])
  useEffect(() => window.notes.onWikiChanged(() => { window.notes.wikiPage(slug).then(setPage) }), [slug])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onBack() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  // [[Note#Section]] and [[wiki/pages/slug|Title]] become clickable
  const html = page ? mdToHtml(page.body.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => {
    const t = target.trim()
    const wikiSlug = t.match(/^wiki\/pages\/([^/]+)$/)?.[1]
    const label = alias?.trim() || (wikiSlug ? wikiSlug : t)
    return wikiSlug ? `<a href="#" data-page="${wikiSlug}">${label}</a>` : `<a href="#" data-source="${encodeURIComponent(t)}">${label}</a>`
  })) : ''

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a') as HTMLAnchorElement | null
    if (!a) return
    const src = a.getAttribute('data-source'); const pg = a.getAttribute('data-page')
    if (src) { e.preventDefault(); onOpenSource(decodeURIComponent(src)) }
    else if (pg) { e.preventDefault(); onOpenPage(pg) }
  }

  return (
    <div className="wiki-page">
      <div className="wiki-page-scroll">
        <div className="wiki-page-inner">
          {page === undefined && <p className="hint">Loading…</p>}
          {page === null && <p className="hint">No such page.</p>}
          {page && (
            <>
              <div className="absorb-crumb"><BookOpen /> {KIND_LABEL[page.kind]}{page.updated && <span> · updated {page.updated}</span>}</div>
              <h1 className="wiki-title">{page.title}</h1>
              {page.summary && <p className="wiki-summary">{page.summary}</p>}
              <div className="absorb-text ProseMirror" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
              {page.sources.length > 0 && (
                <div className="wiki-sources">
                  <h3>Drawn from</h3>
                  {page.sources.map((s) => <button key={s} className="note-link" onClick={() => onOpenSource(s)}>{s.replace('#', ' › ')}</button>)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
