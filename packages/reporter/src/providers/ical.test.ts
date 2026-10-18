import assert from "node:assert/strict"
import { test } from "node:test"
import { expandEvents, parseEvents, toItem } from "./ical.js"

const ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:a@google.com",
  "SUMMARY:Stand-up\\, daily",
  "DTSTART:20261017T140000Z",
  "DTEND:20261017T153000Z",
  "LAST-MODIFIED:20261001T000000Z",
  "URL:https://cal/a",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:b@google.com",
  "SUMMARY:All day",
  "DTSTART;VALUE=DATE:20261017",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n")

test("parseEvents reads timed and all-day events and unescapes text", () => {
  const evs = parseEvents(ICS)
  assert.equal(evs.length, 2)
  assert.equal(evs[0]?.uid, "a@google.com")
  assert.equal(evs[0]?.summary, "Stand-up, daily")
  assert.equal(evs[0]?.start.toISOString(), "2026-10-17T14:00:00.000Z")
  assert.equal(evs[1]?.summary, "All day")
})

test("toItem maps to a calendar item with start as meta.at", () => {
  const ev = parseEvents(ICS)[0]
  if (!ev) throw new Error("expected an event")
  const item = toItem(ev, "work")
  assert.equal(item.kind, "calendar")
  assert.equal(item.meta?.at, "2026-10-17T14:00:00.000Z")
  assert.equal(item.url, "https://cal/a")
})

test("toItem carries a timed event's end", () => {
  const ev = parseEvents(ICS)[0]
  if (!ev) throw new Error("expected an event")
  const item = toItem(ev, "work")
  assert.equal(item.meta?.end, "2026-10-17T15:30:00.000Z")
  assert.equal(item.meta?.allDay, undefined)
})

test("toItem gives an all-day event local dates, defaulting to one day", () => {
  const ev = parseEvents(ICS)[1]
  if (!ev) throw new Error("expected an event")
  assert.equal(ev.allDay, true)
  const item = toItem(ev, "work")
  assert.equal(item.meta?.at, "2026-10-17")
  assert.equal(item.meta?.end, "2026-10-18")
  assert.equal(item.meta?.allDay, "true")
})

const RECURRING = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:standup",
  "SUMMARY:Standup",
  "DTSTART:20261005T090000",
  "DTEND:20261005T091500",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
  "EXDATE:20261007T090000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:standup",
  "SUMMARY:Standup (moved)",
  "RECURRENCE-ID:20261012T090000",
  "DTSTART:20261012T100000",
  "DTEND:20261012T101500",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n")

test("expandEvents expands a rule, skips EXDATEs and applies overrides", () => {
  const evs = expandEvents(parseEvents(RECURRING), new Date(2026, 9, 5), new Date(2026, 9, 15))
  const seen = evs.map((e) => `${e.start.getDate()} ${e.start.getHours()}:00 ${e.summary}`).sort()
  assert.deepEqual(seen, ["12 10:00 Standup (moved)", "14 9:00 Standup", "5 9:00 Standup"])
  const five = evs.find((e) => e.start.getDate() === 5)
  assert.equal((five?.end?.getTime() ?? 0) - (five?.start.getTime() ?? 0), 15 * 60_000)
  assert.equal(new Set(evs.map((e) => e.uid)).size, 3)
})
