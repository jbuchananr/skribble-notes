import type { Note } from '../../../shared/types'

export function newNote(): Note {
  const now = Date.now()
  return { id: crypto.randomUUID(), title: '', content: '', preview: '', text: '', pinned: false, tags: [], absorbed: [], createdAt: now, updatedAt: now }
}

export function htmlToText(html: string): string {
  const el = document.createElement('div')
  el.innerHTML = html.replace(/<\/(p|li|h[1-6]|div|blockquote|pre)>/g, ' ')
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

export function displayTitle(n: Note) {
  return n.title.trim() || 'New Note'
}
