/** Strips scripts / event handlers from editor HTML before it is rendered statically. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(n => n.remove())
  doc.body.querySelectorAll('*').forEach(el => {
    for (const a of [...el.attributes]) {
      if (a.name.startsWith('on') || (['href', 'src'].includes(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name)
    }
  })
  return doc.body.innerHTML
}
