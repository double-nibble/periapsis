// Expands an iCalendar RRULE into the occurrence starts that fall in a window.
// Supports FREQ (DAILY, WEEKLY, MONTHLY, YEARLY), INTERVAL, COUNT, UNTIL,
// BYDAY (with ordinals for monthly and yearly rules), BYMONTHDAY and BYMONTH.

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]
// Bounds the walk from an old start date to the window.
const MAX_DAYS = 20_000

export interface Rule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"
  interval: number
  count?: number
  until?: Date
  byDay: { weekday: number; nth: number }[]
  byMonthDay: number[]
  byMonth: number[]
}

export function parseRule(value: string, parseUntil: (v: string) => Date): Rule | null {
  const parts = new Map(
    value.split(";").map((p) => {
      const [k, v = ""] = p.split("=")
      return [k?.toUpperCase() ?? "", v] as const
    }),
  )
  const freq = parts.get("FREQ")
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null
  const nums = (key: string) =>
    (parts.get(key) ?? "")
      .split(",")
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n !== 0)
  const byDay = (parts.get("BYDAY") ?? "")
    .split(",")
    .filter(Boolean)
    .map((d) => {
      const m = /^([+-]?\d{0,2})([A-Z]{2})$/.exec(d.toUpperCase())
      return m ? { weekday: WEEKDAYS.indexOf(m[2] ?? ""), nth: Number(m[1] || 0) } : null
    })
    .filter((d): d is { weekday: number; nth: number } => d !== null && d.weekday >= 0)
  const count = Number(parts.get("COUNT"))
  const until = parts.get("UNTIL")
  return {
    freq,
    interval: Math.max(1, Number(parts.get("INTERVAL")) || 1),
    count: Number.isInteger(count) && count > 0 ? count : undefined,
    until: until ? parseUntil(until) : undefined,
    byDay,
    byMonthDay: nums("BYMONTHDAY"),
    byMonth: nums("BYMONTH"),
  }
}

interface Fields {
  y: number
  m: number
  d: number
  weekday: number
}

// Whether the day is the nth (or nth from last, when negative) such weekday of its month.
function nthOfMonth(f: Fields, nth: number): boolean {
  if (nth === 0) return true
  const daysInMonth = new Date(Date.UTC(f.y, f.m + 1, 0)).getUTCDate()
  return nth > 0 ? Math.ceil(f.d / 7) === nth : Math.ceil((daysInMonth - f.d + 1) / 7) === -nth
}

function monthDayMatches(f: Fields, list: number[]): boolean {
  const daysInMonth = new Date(Date.UTC(f.y, f.m + 1, 0)).getUTCDate()
  return list.some((n) => (n > 0 ? f.d === n : f.d === daysInMonth + n + 1))
}

function matches(rule: Rule, f: Fields, first: Fields, dayIndex: number): boolean {
  const months = (f.y - first.y) * 12 + (f.m - first.m)
  if (rule.byMonth.length && !rule.byMonth.includes(f.m + 1)) return false
  if (rule.freq === "DAILY") {
    if (dayIndex % rule.interval !== 0) return false
    return !rule.byDay.length || rule.byDay.some((b) => b.weekday === f.weekday)
  }
  if (rule.freq === "WEEKLY") {
    // Weeks start on Monday, the iCalendar default.
    const monday = (w: number) => (w + 6) % 7
    const week = Math.floor((dayIndex + monday(first.weekday)) / 7)
    if (week % rule.interval !== 0) return false
    const days = rule.byDay.length ? rule.byDay.map((b) => b.weekday) : [first.weekday]
    return days.includes(f.weekday)
  }
  if (rule.freq === "MONTHLY" && months % rule.interval !== 0) return false
  if (rule.freq === "YEARLY") {
    if ((f.y - first.y) % rule.interval !== 0) return false
    if (!rule.byMonth.length && !rule.byDay.length && f.m !== first.m) return false
  }
  if (rule.byDay.length)
    return rule.byDay.some((b) => b.weekday === f.weekday && nthOfMonth(f, b.nth))
  if (rule.byMonthDay.length) return monthDayMatches(f, rule.byMonthDay)
  return f.d === first.d
}

// Occurrence starts of the rule within [from, to), counting COUNT from the
// first occurrence. utc says whether the start's wall time is UTC or local.
export function occurrences(rule: Rule, start: Date, utc: boolean, from: Date, to: Date): Date[] {
  const get = (d: Date): Fields =>
    utc
      ? { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), weekday: d.getUTCDay() }
      : { y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), weekday: d.getDay() }
  const at = (y: number, m: number, d: number): Date =>
    utc
      ? new Date(
          Date.UTC(y, m, d, start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()),
        )
      : new Date(y, m, d, start.getHours(), start.getMinutes(), start.getSeconds())
  const first = get(start)
  const out: Date[] = []
  let seen = 0
  for (let i = 0; i < MAX_DAYS; i++) {
    const day = at(first.y, first.m, first.d + i)
    if (day >= to || (rule.until && day > rule.until)) break
    const f = get(day)
    if (i > 0 && !matches(rule, f, first, i)) continue
    seen += 1
    if (rule.count && seen > rule.count) break
    if (day >= from) out.push(day)
  }
  return out
}
