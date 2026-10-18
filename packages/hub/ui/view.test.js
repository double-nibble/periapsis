import assert from "node:assert/strict"
import { test } from "node:test"
import {
  TYPE_ORDER,
  accountColors,
  ago,
  allDayLanes,
  clampHeight,
  eventSpan,
  eventsOn,
  filterByType,
  fleetItems,
  hourRange,
  itemsFor,
  keepCenter,
  metaRows,
  monthGrid,
  parseWhen,
  presentTypes,
  sameDay,
  scrollToNow,
  snoozeOptions,
  sourceState,
  startOfWeek,
  timedSegments,
  urgent,
  weekDays,
  zoomStep,
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
    { key: "late", meta: { at: "2026-10-17T15:00:00" } },
    { key: "early", meta: { at: "2026-10-17T09:00:00" } },
    { key: "other", meta: { at: "2026-10-18T09:00:00" } },
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

const ev = (key, at, end, allDay) => ({
  key,
  meta: { at, ...(end ? { end } : {}), ...(allDay ? { allDay: "true" } : {}) },
})

test("parseWhen reads a bare date as a local calendar date", () => {
  const d = parseWhen("2026-10-17")
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 9, 17, 0])
})

test("eventSpan defaults the end and recognizes all-day events", () => {
  const timed = eventSpan(ev("t", "2026-10-17T09:00:00"))
  assert.equal(timed.allDay, false)
  assert.equal(timed.end - timed.start, 3_600_000)
  assert.equal(eventSpan(ev("a", "2026-10-17", "2026-10-19", true)).allDay, true)
  // an older item with a bare date and no flag is still all-day, on that day
  const legacy = eventSpan(ev("l", "2026-10-17"))
  assert.equal(legacy.allDay, true)
  assert.equal(legacy.start.getDate(), 17)
  assert.equal(eventSpan({ key: "x", meta: {} }), null)
})

test("eventsOn includes multi-day and overnight events on every day they touch", () => {
  const items = [
    ev("trip", "2026-10-16", "2026-10-19", true),
    ev("night", "2026-10-17T18:30:00", "2026-10-18T09:30:00"),
    ev("lunch", "2026-10-17T12:00:00", "2026-10-17T13:00:00"),
  ]
  const keys = (d) => eventsOn(items, d).map((i) => i.key)
  assert.deepEqual(keys(new Date(2026, 9, 17)), ["trip", "lunch", "night"])
  assert.deepEqual(keys(new Date(2026, 9, 18)), ["trip", "night"])
  assert.deepEqual(keys(new Date(2026, 9, 19)), [])
})

test("allDayLanes spans days and stacks overlapping events in lanes", () => {
  const days = weekDays(new Date(2026, 9, 14)) // Sun 11 .. Sat 17
  const lanes = allDayLanes(
    [
      ev("long", "2026-10-09", "2026-10-14", true), // starts before the week
      ev("mid", "2026-10-13", "2026-10-16", true),
      ev("late", "2026-10-15", "2026-10-25", true), // runs past the week
      ev("timed", "2026-10-13T09:00:00"),
    ],
    days,
  )
  const by = Object.fromEntries(lanes.map((l) => [l.item.key, l]))
  assert.equal(lanes.length, 3)
  assert.deepEqual([by.long.from, by.long.to, by.long.before], [0, 3, true])
  assert.deepEqual([by.mid.from, by.mid.to, by.mid.lane], [2, 5, 1])
  assert.deepEqual([by.late.from, by.late.to, by.late.lane, by.late.after], [4, 7, 0, true])
})

test("timedSegments clips overnight events and places overlaps side by side", () => {
  const items = [
    ev("a", "2026-10-17T09:00:00", "2026-10-17T10:00:00"),
    ev("b", "2026-10-17T09:30:00", "2026-10-17T10:30:00"),
    ev("c", "2026-10-17T10:30:00", "2026-10-17T11:00:00"),
    ev("night", "2026-10-16T22:00:00", "2026-10-17T02:00:00"),
    ev("allday", "2026-10-17", "2026-10-18", true),
  ]
  const segs = Object.fromEntries(
    timedSegments(items, new Date(2026, 9, 17)).map((s) => [s.item.key, s]),
  )
  assert.equal(segs.allday, undefined)
  assert.deepEqual([segs.night.startMin, segs.night.endMin, segs.night.before], [0, 120, true])
  assert.deepEqual([segs.a.col, segs.a.cols], [0, 2])
  assert.deepEqual([segs.b.col, segs.b.cols], [1, 2])
  assert.deepEqual([segs.c.col, segs.c.cols], [0, 1])
  const prev = timedSegments(items, new Date(2026, 9, 16)).find((s) => s.item.key === "night")
  assert.deepEqual([prev.startMin, prev.endMin, prev.after], [1320, 1440, true])
})

test("hourRange covers the working day, widened to fit events", () => {
  assert.deepEqual(hourRange([]), { from: 8, to: 18 })
  assert.deepEqual(hourRange([{ startMin: 390, endMin: 1290 }]), { from: 6, to: 22 })
})

test("accountColors gives each account a stable slot", () => {
  assert.deepEqual(accountColors(["sub1", "sub2"]), { sub1: 0, sub2: 1 })
})

test("snoozeOptions offers this evening only while it is ahead", () => {
  const morning = snoozeOptions(new Date(2026, 9, 14, 10, 0))
  assert.deepEqual(
    morning.map((o) => o.label),
    ["1 hour", "This evening", "Tomorrow morning", "Next week"],
  )
  assert.equal(new Date(morning[1].until).getHours(), 18)
  const night = snoozeOptions(new Date(2026, 9, 14, 20, 0))
  assert.equal(
    night.some((o) => o.label === "This evening"),
    false,
  )
})

test("snoozeOptions next week is the following Monday at 9", () => {
  const sunday = snoozeOptions(new Date(2026, 9, 18, 12, 0))
  const next = new Date(sunday.at(-1).until)
  assert.equal(next.getDay(), 1)
  assert.equal(next.getDate(), 19)
  assert.equal(next.getHours(), 9)
  const monday = new Date(snoozeOptions(new Date(2026, 9, 19, 12, 0)).at(-1).until)
  assert.equal(monday.getDate(), 26)
})

test("metaRows labels known fields in order, hides internal ones, and reads times", () => {
  const now = Date.parse("2026-10-18T12:00:00Z")
  assert.deepEqual(
    metaRows(
      {
        instance: "gh",
        role: "author",
        ref: "acme/api#7",
        createdAt: "2026-10-16T12:00:00Z",
        statusLabel: "In review",
        action: "Merge it",
        waitingOn: "",
        progress: "0.4",
        custom: "x",
      },
      now,
    ),
    [
      ["Next", "Merge it"],
      ["Status", "In review"],
      ["Opened", "2d ago"],
      ["Progress", "40%"],
      ["custom", "x"],
    ],
  )
})

test("zoomStep moves one level, stops at the ends, and resets", () => {
  assert.equal(zoomStep(1, 1), 1.25)
  assert.equal(zoomStep(1, -1), 0.75)
  assert.equal(zoomStep(3, 1), 3)
  assert.equal(zoomStep(0.5, -1), 0.5)
  assert.equal(zoomStep(2, 0), 1)
  assert.equal(zoomStep(1.1, 1), 1.25)
})

test("keepCenter holds the middle of the view in place", () => {
  assert.equal(keepCenter(100, 200, 2), 300)
  assert.equal(keepCenter(0, 200, 0.5), 0)
})

test("clampHeight keeps the view between 80 and 1200 pixels", () => {
  assert.equal(clampHeight(10), 80)
  assert.equal(clampHeight(5000), 1200)
  assert.equal(clampHeight(250.4), 250)
})

test("scrollToNow centers the current time and stays within the day", () => {
  assert.equal(scrollToNow(new Date(2026, 9, 18, 11, 0), 22, 200), 142)
  assert.equal(scrollToNow(new Date(2026, 9, 18, 1, 0), 22, 200), 0)
  assert.equal(scrollToNow(new Date(2026, 9, 18, 23, 30), 22, 200), 328)
})

test("ago is brief: minutes, hours, then days", () => {
  const now = Date.parse("2026-10-18T12:00:00Z")
  assert.equal(ago("2026-10-18T11:30:00Z", now), "30m")
  assert.equal(ago("2026-10-18T07:00:00Z", now), "5h")
  assert.equal(ago("2026-10-15T12:00:00Z", now), "3d")
  assert.equal(ago("not a date", now), "")
})

test("sourceState flags failures, partial failures and silence", () => {
  const now = 10 * 3_600_000
  const fine = { lastSeen: now - 60_000, error: null, note: null }
  assert.equal(sourceState(fine, now), "ok")
  assert.equal(sourceState({ ...fine, error: "needs-auth" }, now), "error")
  assert.equal(sourceState({ ...fine, note: "one instance failed" }, now), "warn")
  assert.equal(sourceState({ ...fine, lastSeen: now - 4 * 3_600_000 }, now), "warn")
})
