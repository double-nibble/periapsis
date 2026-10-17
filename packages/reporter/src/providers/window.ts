// The six-week grid covering the month that contains `now`: from the Sunday on
// or before the 1st through the Saturday on or after the last day. The end is
// exclusive (midnight after the last grid day). Local time.
export function monthWindow(now: Date): { start: Date; end: Date } {
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const start = new Date(first)
  start.setDate(1 - first.getDay())
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const end = new Date(last)
  end.setDate(last.getDate() + (6 - last.getDay()) + 1)
  return { start, end }
}
