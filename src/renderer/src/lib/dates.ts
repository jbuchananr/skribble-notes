const DAY = 86400000

function startOfDay(t: number) {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function groupLabel(t: number, now = Date.now()): string {
  const today = startOfDay(now)
  const day = startOfDay(t)
  if (day >= today) return 'Today'
  if (day >= today - DAY) return 'Yesterday'
  if (day >= today - 7 * DAY) return 'Previous 7 days'
  if (day >= today - 30 * DAY) return 'Previous 30 days'
  const d = new Date(t)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return d.toLocaleDateString(undefined, sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' })
}

export function shortTime(t: number, now = Date.now()): string {
  const d = new Date(t)
  if (startOfDay(t) >= startOfDay(now)) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (startOfDay(t) >= startOfDay(now) - 7 * DAY) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function longDate(t: number): string {
  return new Date(t).toLocaleString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  })
}
