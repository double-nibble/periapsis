import assert from "node:assert/strict"
import { test } from "node:test"
import { toItem } from "./calendar.js"

test("toItem maps a timed event to a calendar item with its start as meta.at", () => {
  const item = toItem(
    {
      id: "ev1",
      summary: "Standup",
      htmlLink: "https://cal/ev1",
      updated: "2026-10-17T00:00:00Z",
      start: { dateTime: "2026-10-17T09:00:00-05:00" },
    },
    "work",
  )
  assert.equal(item.kind, "calendar")
  assert.equal(item.title, "Standup")
  assert.equal(item.key, "ev1")
  assert.equal(item.meta?.at, "2026-10-17T09:00:00-05:00")
  assert.equal(item.meta?.instance, "work")
})

test("toItem falls back to all-day date and a placeholder title", () => {
  const item = toItem({ id: "ev2", start: { date: "2026-10-17" } }, "work")
  assert.equal(item.title, "(busy)")
  assert.equal(item.meta?.at, "2026-10-17")
})

test("toItem namespaces the key by calendar and tags the calendar name", () => {
  const item = toItem(
    { id: "ev1", summary: "Sync", start: { dateTime: "2026-10-17T09:00:00Z" } },
    "work",
    { id: "team@group.calendar.google.com", summary: "Team" },
  )
  assert.equal(item.key, "team@group.calendar.google.com/ev1")
  assert.equal(item.group, "Team")
})

test("toItem carries the end, and marks an all-day event with dates", () => {
  const timed = toItem(
    {
      id: "a",
      start: { dateTime: "2026-10-17T09:00:00-05:00" },
      end: { dateTime: "2026-10-17T10:30:00-05:00" },
    },
    "work",
  )
  assert.equal(timed.meta?.end, "2026-10-17T10:30:00-05:00")
  assert.equal(timed.meta?.allDay, undefined)
  const allDay = toItem(
    { id: "b", start: { date: "2026-10-16" }, end: { date: "2026-10-18" } },
    "work",
  )
  assert.equal(allDay.meta?.at, "2026-10-16")
  assert.equal(allDay.meta?.end, "2026-10-18")
  assert.equal(allDay.meta?.allDay, "true")
})
