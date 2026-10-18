import type { InstanceConfig, Provider, ProviderItem, ProviderResult } from "../provider.js"
import { occurrences, parseRule } from "./rrule.js"
import { monthWindow } from "./window.js"

export interface RawEvent {
  uid: string
  summary?: string
  url?: string
  start: Date
  end?: Date
  allDay: boolean
  stamp: string
  // Recurrence: the rule, excluded starts, and for an overridden occurrence
  // the start it replaces.
  rrule?: string
  // Whether the start is a UTC time; otherwise it is local (floating or TZID).
  utc?: boolean
  exdates?: number[]
  recurrenceId?: number
}

// ICS folds long lines with a CRLF followed by a space or tab; rejoin them.
function unfold(ics: string): string[] {
  const out: string[] = []
  for (const line of ics.split(/\r?\n/)) {
    const prev = out.length - 1
    if (prev >= 0 && (line.startsWith(" ") || line.startsWith("\t"))) out[prev] += line.slice(1)
    else out.push(line)
  }
  return out
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1")
}

function isDateOnly(left: string, value: string): boolean {
  return /VALUE=DATE(?![-T])/.test(left) || /^\d{8}$/.test(value)
}

function parseDate(left: string, value: string): Date {
  const y = Number(value.slice(0, 4))
  const mo = Number(value.slice(4, 6)) - 1
  const d = Number(value.slice(6, 8))
  if (isDateOnly(left, value)) return new Date(y, mo, d)
  const h = Number(value.slice(9, 11)) || 0
  const mi = Number(value.slice(11, 13)) || 0
  const s = Number(value.slice(13, 15)) || 0
  return value.endsWith("Z") ? new Date(Date.UTC(y, mo, d, h, mi, s)) : new Date(y, mo, d, h, mi, s)
}

export function parseEvents(ics: string): RawEvent[] {
  const events: RawEvent[] = []
  let uid = ""
  let summary: string | undefined
  let url: string | undefined
  let start: Date | undefined
  let end: Date | undefined
  let allDay = false
  let stamp = ""
  let rrule: string | undefined
  let utc = false
  let exdates: number[] = []
  let recurrenceId: number | undefined
  let open = false
  for (const line of unfold(ics)) {
    if (line === "BEGIN:VEVENT") {
      open = true
      uid = ""
      summary = undefined
      url = undefined
      start = undefined
      end = undefined
      allDay = false
      stamp = ""
      rrule = undefined
      utc = false
      exdates = []
      recurrenceId = undefined
      continue
    }
    if (line === "END:VEVENT") {
      if (open && start && uid)
        events.push({
          uid,
          summary,
          url,
          start,
          end,
          allDay,
          stamp,
          rrule,
          utc,
          exdates,
          recurrenceId,
        })
      open = false
      continue
    }
    if (!open) continue
    const idx = line.indexOf(":")
    if (idx < 0) continue
    const left = line.slice(0, idx)
    const value = line.slice(idx + 1)
    const name = left.split(";")[0]
    if (name === "UID") uid = value
    else if (name === "SUMMARY") summary = unescapeText(value)
    else if (name === "URL") url = value
    else if (name === "DTSTART") {
      start = parseDate(left, value)
      allDay = isDateOnly(left, value)
      utc = !allDay && value.endsWith("Z")
    } else if (name === "DTEND") end = parseDate(left, value)
    else if ((name === "LAST-MODIFIED" || name === "DTSTAMP") && !stamp) stamp = value
    else if (name === "RRULE") rrule = value
    else if (name === "EXDATE")
      exdates.push(...value.split(",").map((v) => parseDate(left, v).getTime()))
    else if (name === "RECURRENCE-ID") recurrenceId = parseDate(left, value).getTime()
  }
  return events
}

// The events that start in [from, to): single events as they are, and each
// occurrence of a recurring event, keyed by its start, unless it is excluded
// or replaced by an overriding event.
export function expandEvents(events: RawEvent[], from: Date, to: Date): RawEvent[] {
  const replaced = new Set(
    events.filter((e) => e.recurrenceId !== undefined).map((e) => `${e.uid}@${e.recurrenceId}`),
  )
  const out: RawEvent[] = []
  for (const ev of events) {
    const rule =
      ev.rrule && ev.recurrenceId === undefined
        ? parseRule(ev.rrule, (v) => parseDate("", v))
        : null
    if (!rule) {
      if (ev.start >= from && ev.start < to)
        out.push(
          ev.recurrenceId === undefined ? ev : { ...ev, uid: `${ev.uid}/${ev.recurrenceId}` },
        )
      continue
    }
    const length = ev.end ? ev.end.getTime() - ev.start.getTime() : undefined
    for (const start of occurrences(rule, ev.start, ev.utc === true, from, to)) {
      const t = start.getTime()
      if (ev.exdates?.includes(t) || replaced.has(`${ev.uid}@${t}`)) continue
      out.push({
        ...ev,
        uid: `${ev.uid}/${t}`,
        start,
        end: length !== undefined ? new Date(t + length) : undefined,
      })
    }
  }
  return out
}

// A local calendar date as YYYY-MM-DD.
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function toItem(ev: RawEvent, instance: string): ProviderItem {
  // All-day events carry dates (end exclusive); timed events carry instants.
  const at = ev.allDay ? ymd(ev.start) : ev.start.toISOString()
  const end = ev.allDay
    ? ymd(ev.end ?? new Date(ev.start.getFullYear(), ev.start.getMonth(), ev.start.getDate() + 1))
    : ev.end?.toISOString()
  return {
    key: ev.uid,
    kind: "calendar",
    priority: 2,
    title: ev.summary ?? "(busy)",
    detail: at,
    url: ev.url,
    fingerprint: `${ev.stamp}:${at}`,
    meta: { at, instance, ...(end ? { end } : {}), ...(ev.allDay ? { allDay: "true" } : {}) },
  }
}

// Params: { icsUrl }. Reads the month's events from an iCal feed, with
// recurring events expanded into their occurrences.
export const ical: Provider = {
  source: "calendar",
  async read(config: InstanceConfig): Promise<ProviderResult> {
    const icsUrl = String(config.params?.icsUrl ?? "")
    if (!icsUrl) throw new Error("ical instance needs icsUrl")
    const res = await fetch(icsUrl)
    if (!res.ok) throw new Error(`ical fetch ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const { start, end } = monthWindow(new Date())
    const items = expandEvents(parseEvents(await res.text()), start, end).map((ev) =>
      toItem(ev, config.instance),
    )
    return { items }
  },
}
