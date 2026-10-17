import assert from "node:assert/strict"
import { test } from "node:test"
import {
  TYPE_ORDER,
  eventsOn,
  filterByType,
  fleetItems,
  itemsFor,
  monthGrid,
  presentTypes,
  sameDay,
  startOfWeek,
  urgent,
  weekDays,
} from "./view.js"

const model = {
  accounts: [
    {
      account: "sub1",
      items: [
        { key: "a", account: "sub1", priority: 2 },
        { key: "b", account: "sub1", priority: 1 },
      ],
    },
    { account: "sub2", items: [{ key: "c", account: "sub2", priority: 1 }] },
  ],
}

test("fleetItems flattens every account and sorts by priority then key", () => {
  assert.deepEqual(
    fleetItems(model).map((i) => i.key),
    ["b", "c", "a"],
  )
})

test("itemsFor returns one account's items, or the fleet for All", () => {
  assert.deepEqual(
    itemsFor(model, "sub2").map((i) => i.key),
    ["c"],
  )
  assert.equal(itemsFor(model, "All").length, 3)
  assert.deepEqual(itemsFor(model, "missing"), [])
})

test("urgent counts priority-1 items", () => {
  assert.equal(urgent(fleetItems(model)), 2)
})

const mixed = [
  { key: "a", source: "code", priority: 1 },
  { key: "b", source: "messages", priority: 2 },
  { key: "c", source: "code", priority: 2 },
  { key: "d", source: "doorbell", priority: 3 },
]

test("presentTypes keeps the canonical order and appends unknowns alphabetically", () => {
  assert.deepEqual(presentTypes(mixed), ["code", "messages", "doorbell"])
  assert.ok(TYPE_ORDER.includes("calendar"))
})

test("filterByType narrows to one source, All keeps everything", () => {
  assert.deepEqual(
    filterByType(mixed, "code").map((i) => i.key),
    ["a", "c"],
  )
  assert.equal(filterByType(mixed, "All").length, 4)
})

// Saturday, 17 Oct 2026
const ref = new Date(2026, 9, 17, 12, 0, 0)

test("startOfWeek is the preceding Sunday at midnight", () => {
  const s = startOfWeek(ref)
  assert.equal(s.getDay(), 0)
  assert.equal(s.getDate(), 11)
  assert.equal(s.getHours(), 0)
})

test("weekDays is seven consecutive days from Sunday", () => {
  const days = weekDays(ref)
  assert.equal(days.length, 7)
  assert.deepEqual(
    days.map((d) => d.getDate()),
    [11, 12, 13, 14, 15, 16, 17],
  )
})

test("monthGrid covers every day of the month in whole weeks", () => {
  const weeks = monthGrid(ref)
  const flat = weeks.flat()
  assert.equal(flat.length % 7, 0)
  assert.ok(flat.some((d) => d.getMonth() === 9 && d.getDate() === 1))
  assert.ok(flat.some((d) => d.getMonth() === 9 && d.getDate() === 31))
  assert.equal(weeks[0][0].getDay(), 0)
})

test("eventsOn selects a day's events, sorted by start", () => {
  const items = [
    { key: "late", meta: { at: "2026-10-17T15:00:00.000Z" } },
    { key: "early", meta: { at: "2026-10-17T09:00:00.000Z" } },
    { key: "other", meta: { at: "2026-10-18T09:00:00.000Z" } },
    { key: "none", meta: {} },
  ]
  const day = new Date(2026, 9, 17, 0, 0, 0)
  const got = eventsOn(items, day).map((i) => i.key)
  assert.ok(got.includes("early") && got.includes("late"))
  assert.equal(got.indexOf("early"), 0)
  assert.ok(!got.includes("other") && !got.includes("none"))
})

test("sameDay ignores time of day", () => {
  assert.ok(sameDay(new Date(2026, 9, 17, 1), new Date(2026, 9, 17, 23)))
  assert.ok(!sameDay(new Date(2026, 9, 17), new Date(2026, 9, 18)))
})
