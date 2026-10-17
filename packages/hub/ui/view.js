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

export function eventsOn(items, date) {
  return items
    .filter((i) => i.meta?.at && sameDay(new Date(i.meta.at), date))
    .sort((a, b) => a.meta.at.localeCompare(b.meta.at))
}
