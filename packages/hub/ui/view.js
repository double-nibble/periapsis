// Pure view helpers for the dashboard. No DOM access, so they are unit-testable.

const byPriority = (a, b) => a.priority - b.priority || a.key.localeCompare(b.key)

// Every reporter's items in one list, sorted, for the fleet-wide "All" view.
export function fleetItems(model) {
  return model.accounts.flatMap((a) => a.items).sort(byPriority)
}

// Items for the chosen sidebar entry: a single account, or the whole fleet.
export function itemsFor(model, who) {
  if (who === "All") return fleetItems(model)
  return model.accounts.find((a) => a.account === who)?.items ?? []
}

export function urgent(items) {
  return items.filter((i) => i.priority === 1).length
}

// Provider types in the order they should appear as tabs; any unknown source
// is appended after these, alphabetically.
export const TYPE_ORDER = ["calendar", "code", "tickets", "messages", "email", "docs"]

export function presentTypes(items) {
  const seen = new Set(items.map((i) => i.source))
  const known = TYPE_ORDER.filter((t) => seen.has(t))
  const extra = [...seen].filter((t) => !TYPE_ORDER.includes(t)).sort()
  return [...known, ...extra]
}

export function filterByType(items, type) {
  return type === "All" ? items : items.filter((i) => i.source === type)
}

// --- calendar helpers ---------------------------------------------------

export function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function startOfWeek(d) {
  const x = startOfDay(d)
  x.setDate(x.getDate() - x.getDay())
  return x
}

export function weekDays(ref) {
  const s = startOfWeek(ref)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(s)
    d.setDate(s.getDate() + i)
    return d
  })
}

export function monthGrid(ref) {
  const month = ref.getMonth()
  const nextMonth = new Date(ref.getFullYear(), month + 1, 1)
  const cursor = startOfWeek(new Date(ref.getFullYear(), month, 1))
  const weeks = []
  while (cursor < nextMonth) {
    const row = []
    for (let i = 0; i < 7; i++) {
      row.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(row)
  }
  return weeks
}

export function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

// A time from item meta. A bare YYYY-MM-DD is a local calendar date, not UTC
// midnight (which would land on the previous evening west of UTC).
export function parseWhen(s) {
  const m = DATE_ONLY.exec(s)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s)
}

// When a calendar item runs, or null if it has no start. Without an end, a
// timed event lasts an hour and an all-day event one day.
export function eventSpan(item) {
  const meta = item.meta ?? {}
  if (!meta.at) return null
  const allDay = meta.allDay === "true" || DATE_ONLY.test(meta.at)
  const start = parseWhen(meta.at)
  let end = meta.end ? parseWhen(meta.end) : null
  if (!end || end <= start) end = allDay ? addDays(start, 1) : new Date(start.getTime() + 3_600_000)
  return { start, end, allDay }
}

// Events touching a day, earliest first.
export function eventsOn(items, date) {
  const from = startOfDay(date)
  const to = addDays(from, 1)
  return items
    .map((item) => ({ item, span: eventSpan(item) }))
    .filter(({ span }) => span && span.start < to && span.end > from)
    .sort((a, b) => a.span.start - b.span.start)
    .map(({ item }) => item)
}

function dayIndex(first, d) {
  return Math.round((startOfDay(d) - first) / 86_400_000)
}

// All-day events across a run of days, packed into lanes so overlapping ones
// stack. from/to are day columns (to exclusive), clipped to the run.
export function allDayLanes(items, days) {
  const first = startOfDay(days[0])
  const after = addDays(first, days.length)
  const spans = items
    .map((item) => ({ item, span: eventSpan(item) }))
    .filter(({ span }) => span?.allDay && span.start < after && span.end > first)
    .sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end)
  const laneEnds = []
  return spans.map(({ item, span }) => {
    const from = Math.max(0, dayIndex(first, span.start))
    const midnight = span.end.getHours() === 0 && span.end.getMinutes() === 0
    const to = Math.min(
      days.length,
      Math.max(from + 1, dayIndex(first, span.end) + (midnight ? 0 : 1)),
    )
    let lane = laneEnds.findIndex((end) => end <= from)
    if (lane < 0) {
      lane = laneEnds.length
      laneEnds.push(0)
    }
    laneEnds[lane] = to
    return { item, from, to, lane, before: span.start < first, after: span.end > after }
  })
}

function minuteOfDay(d) {
  return d.getHours() * 60 + d.getMinutes()
}

// Timed events on one day as minute ranges, clipped to the day (an overnight
// event continues on the next), laid out in side-by-side columns.
export function timedSegments(items, day) {
  const from = startOfDay(day)
  const to = addDays(from, 1)
  const segments = []
  for (const item of items) {
    const span = eventSpan(item)
    if (!span || span.allDay || span.start >= to || span.end <= from) continue
    segments.push({
      item,
      startMin: span.start > from ? minuteOfDay(span.start) : 0,
      endMin: span.end < to ? minuteOfDay(span.end) || 1440 : 1440,
      before: span.start < from,
      after: span.end > to,
    })
  }
  return layoutColumns(segments)
}

// The shortest an event is drawn, in minutes; layout treats it as that long so
// short events that look overlapping are placed side by side.
export const MIN_EVENT_MINUTES = 20

// Places overlapping segments side by side: each cluster of mutually reachable
// overlaps shares its column count, and each segment takes the first free column.
export function layoutColumns(segments) {
  const sorted = [...segments].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)
  const out = []
  let cluster = []
  let columns = []
  let clusterEnd = -1
  const close = () => {
    for (const s of cluster) s.cols = columns.length
    out.push(...cluster)
    cluster = []
    columns = []
  }
  for (const seg of sorted) {
    const end = Math.max(seg.endMin, seg.startMin + MIN_EVENT_MINUTES)
    if (cluster.length && seg.startMin >= clusterEnd) close()
    let col = columns.findIndex((colEnd) => colEnd <= seg.startMin)
    if (col < 0) {
      col = columns.length
      columns.push(0)
    }
    columns[col] = end
    cluster.push({ ...seg, col })
    clusterEnd = cluster.length === 1 ? end : Math.max(clusterEnd, end)
  }
  if (cluster.length) close()
  return out
}

// The hours a time grid shows: the working day, widened to fit every segment.
export function hourRange(segments) {
  let from = 8
  let to = 18
  for (const s of segments) {
    from = Math.min(from, Math.floor(s.startMin / 60))
    to = Math.max(to, Math.ceil(Math.max(s.endMin, s.startMin + MIN_EVENT_MINUTES) / 60))
  }
  return { from, to: Math.min(24, to) }
}

// A stable color slot per account, in the order the accounts are listed.
export const ACCOUNT_COLORS = 8
export function accountColors(accounts) {
  const out = {}
  accounts.forEach((name, i) => {
    out[name] = i % ACCOUNT_COLORS
  })
  return out
}

// When a snooze ends: in an hour, this evening (while it is still ahead),
// tomorrow morning, or next Monday morning.
export function snoozeOptions(now) {
  const at = (days, hour) => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    d.setHours(hour, 0, 0, 0)
    return d.getTime()
  }
  const out = [{ label: "1 hour", until: now.getTime() + 3_600_000 }]
  if (now.getHours() < 17) out.push({ label: "This evening", until: at(0, 18) })
  out.push({ label: "Tomorrow morning", until: at(1, 9) })
  out.push({ label: "Next week", until: at((8 - now.getDay()) % 7 || 7, 9) })
  return out
}

const META_LABELS = {
  action: "Next",
  statusLabel: "Status",
  state: "State",
  author: "Author",
  waitingOn: "Waiting on",
  checks: "Checks",
  failing: "Failing",
  threads: "Open threads",
  stackedOn: "Stacked on",
  size: "Size",
  createdAt: "Opened",
  health: "Health",
  progress: "Progress",
  target: "Target",
  lead: "Lead",
  lastUpdate: "Last update",
  issues: "Open issues",
  forYou: "For you",
  toAnswer: "To answer",
  todos: "To-dos",
  edited: "Edited",
  at: "Starts",
  end: "Ends",
  cost: "Cost",
}
const META_HIDDEN = new Set([
  "instance",
  "role",
  "status",
  "ref",
  "repo",
  "prTitle",
  "isLead",
  "allDay",
])
const META_TIMES = new Set(["createdAt", "lastUpdate", "edited", "at", "end"])

function metaValue(key, value, now) {
  if (META_TIMES.has(key) && /^\d{4}-\d\d-\d\dT/.test(value)) {
    const t = Date.parse(value)
    if (t <= now) return `${ago(value, now)} ago`
    return new Date(t).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })
  }
  if (key === "progress" && value !== "") return `${Math.round(Number(value) * 100)}%`
  return value
}

// An opened item's meta as labeled, readable rows: known fields first in a
// fixed order, internal fields left out, times shown relative to now.
export function metaRows(meta, now = Date.now()) {
  const entries = Object.entries(meta ?? {}).filter(([k, v]) => !META_HIDDEN.has(k) && v !== "")
  const order = Object.keys(META_LABELS)
  const rank = (k) => (order.includes(k) ? order.indexOf(k) : order.length)
  return entries
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([k, v]) => [META_LABELS[k] ?? k, metaValue(k, v, now)])
}

// Vertical zoom levels for a scrollable time grid, as multiples of its base
// hour height.
export const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]

// The next zoom level in a direction: 1 in, -1 out, 0 back to 1.
export function zoomStep(zoom, dir) {
  if (dir === 0) return 1
  const i = ZOOMS.indexOf(zoom)
  const at = i === -1 ? ZOOMS.indexOf(1) : i
  return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, at + dir))]
}

// Where to scroll after the content scales by ratio, so the time at the middle
// of the view stays in the middle.
export function keepCenter(scrollTop, viewHeight, ratio) {
  return Math.max(0, (scrollTop + viewHeight / 2) * ratio - viewHeight / 2)
}

export function clampHeight(px) {
  return Math.round(Math.min(1200, Math.max(80, px)))
}

// The scroll offset that puts the current time in the middle of a day-long
// pane of the given height.
export function scrollToNow(now, hourPx, viewHeight) {
  const at = ((now.getHours() * 60 + now.getMinutes()) / 60) * hourPx
  return Math.round(Math.min(24 * hourPx - viewHeight, Math.max(0, at - viewHeight / 2)))
}

// How long ago an ISO time was, briefly: "5m", "3h", "2d".
export function ago(iso, now = Date.now()) {
  const ms = Math.max(0, now - Date.parse(iso))
  if (Number.isNaN(ms)) return ""
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / 86_400_000)}d`
}

// A source is stale when it has not reported for this long.
export const STALE_MS = 3 * 3_600_000

// How a source is doing: failing, partly failing or stale, or fine.
export function sourceState(src, now = Date.now()) {
  if (src.error) return "error"
  if (src.note || now - src.lastSeen > STALE_MS) return "warn"
  return "ok"
}

// The commands sent about an item, newest first. For a task, that includes the
// command that started it, whose id is the task's key.
export function commandsFor(commands, item) {
  return commands.filter(
    (c) =>
      c.account === item.account &&
      ((c.source === item.source && c.key === item.key) ||
        (item.source === "tasks" && c.id === item.key)),
  )
}
