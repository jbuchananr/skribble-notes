const DROP = 'script, style, iframe, object, embed, link, meta, img, video, audio, form, input, button, textarea'

/** Note HTML made safe for a read-only preview: no scripts, handlers, embeds or javascript: links. Parsing with DOMParser never runs anything. */
export function previewHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  doc.body.querySelectorAll(DROP).forEach((el) => el.remove())
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      const v = a.value.trim().toLowerCase()
      if (a.name.startsWith('on') || a.name === 'style' || ((a.name === 'href' || a.name === 'src') && !/^(https?:|mailto:|#)/.test(v))) el.removeAttribute(a.name)
    }
  })
  return doc.body.innerHTML
}
