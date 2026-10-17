import assert from "node:assert/strict"
import { test } from "node:test"
import { parseEvents, toItem } from "./ical.js"

const ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:a@google.com",
  "SUMMARY:Stand-up\\, daily",
  "DTSTART:20261017T140000Z",
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
