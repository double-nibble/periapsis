import type { InstanceConfig, Provider, ProviderItem, ProviderResult } from "../provider.js"
import { monthWindow } from "./window.js"

export interface RawEvent {
  uid: string
  summary?: string
  url?: string
  start: Date
  stamp: string
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

function parseDate(left: string, value: string): Date {
  const y = Number(value.slice(0, 4))
  const mo = Number(value.slice(4, 6)) - 1
  const d = Number(value.slice(6, 8))
  if (/VALUE=DATE(?![-T])/.test(left) || /^\d{8}$/.test(value)) return new Date(y, mo, d)
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
  let stamp = ""
  let open = false
  for (const line of unfold(ics)) {
    if (line === "BEGIN:VEVENT") {
      open = true
      uid = ""
      summary = undefined
      url = undefined
      start = undefined
      stamp = ""
      continue
    }
    if (line === "END:VEVENT") {
      if (open && start && uid) events.push({ uid, summary, url, start, stamp })
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
    else if (name === "DTSTART") start = parseDate(left, value)
    else if ((name === "LAST-MODIFIED" || name === "DTSTAMP") && !stamp) stamp = value
  }
  return events
}

export function toItem(ev: RawEvent, instance: string): ProviderItem {
  const at = ev.start.toISOString()
  return {
    key: ev.uid,
    kind: "calendar",
    priority: 2,
    title: ev.summary ?? "(busy)",
    detail: at,
    url: ev.url,
    fingerprint: `${ev.stamp}:${at}`,
    meta: { at, instance },
  }
}

// Params: { icsUrl }. Reads today's events from a secret iCal feed. Recurring
// events are not expanded; the gcal provider covers recurrence.
export const ical: Provider = {
  source: "calendar",
  async read(config: InstanceConfig): Promise<ProviderResult> {
    const icsUrl = String(config.params?.icsUrl ?? "")
    if (!icsUrl) throw new Error("ical instance needs icsUrl")
    const res = await fetch(icsUrl)
    if (!res.ok) throw new Error(`ical fetch ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const { start, end } = monthWindow(new Date())
    const items = parseEvents(await res.text())
      .filter((ev) => ev.start >= start && ev.start < end)
      .map((ev) => toItem(ev, config.instance))
    return { items }
  },
}
