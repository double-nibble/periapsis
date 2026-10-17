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
