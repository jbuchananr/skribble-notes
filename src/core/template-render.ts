/** Fill placeholders: {{date}} -> 10/19, {{longdate}} -> Monday, October 19, {{time}} -> 2:30 PM. Browser-safe. */
export function renderTemplate(body: string, now = new Date()): string {
  return body
    .replace(/\{\{date\}\}/g, `${now.getMonth() + 1}/${now.getDate()}`)
    .replace(/\{\{longdate\}\}/g, now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))
    .replace(/\{\{time\}\}/g, now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))
}
