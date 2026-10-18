import assert from "node:assert/strict"
import { test } from "node:test"
import { occurrences, parseRule } from "./rrule.js"

const local = (v: string) =>
  new Date(Number(v.slice(0, 4)), Number(v.slice(4, 6)) - 1, Number(v.slice(6, 8)), 23, 59, 59)
const rule = (v: string) => {
  const r = parseRule(v, local)
  if (!r) throw new Error(`bad rule ${v}`)
  return r
}
const days = (ds: Date[]) => ds.map((d) => `${d.getMonth() + 1}/${d.getDate()}`)
const OCT = new Date(2026, 9, 1)
const NOV = new Date(2026, 10, 1)

test("weekly on two days, every other week", () => {
  const start = new Date(2026, 8, 7, 9, 0) // Mon 7 Sep
  const got = occurrences(rule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"), start, false, OCT, NOV)
  assert.deepEqual(days(got), ["10/5", "10/7", "10/19", "10/21"])
  assert.equal(got[0]?.getHours(), 9)
})

test("monthly on the second Tuesday and on the last Friday", () => {
  const start = new Date(2026, 0, 13, 15, 0)
  assert.deepEqual(days(occurrences(rule("FREQ=MONTHLY;BYDAY=2TU"), start, false, OCT, NOV)), [
    "10/13",
  ])
  assert.deepEqual(days(occurrences(rule("FREQ=MONTHLY;BYDAY=-1FR"), start, false, OCT, NOV)), [
    "10/30",
  ])
})

test("monthly on a day of the month, and yearly on the start's date", () => {
  const start = new Date(2025, 9, 31, 8, 0)
  assert.deepEqual(days(occurrences(rule("FREQ=MONTHLY;BYMONTHDAY=-1"), start, false, OCT, NOV)), [
    "10/31",
  ])
  assert.deepEqual(days(occurrences(rule("FREQ=YEARLY"), start, false, OCT, NOV)), ["10/31"])
})

test("daily stops at COUNT and at UNTIL", () => {
  const start = new Date(2026, 9, 28, 7, 0)
  assert.deepEqual(days(occurrences(rule("FREQ=DAILY;COUNT=3"), start, false, OCT, NOV)), [
    "10/28",
    "10/29",
    "10/30",
  ])
  assert.deepEqual(days(occurrences(rule("FREQ=DAILY;UNTIL=20261029"), start, false, OCT, NOV)), [
    "10/28",
    "10/29",
  ])
})

test("a UTC start keeps its UTC time across occurrences", () => {
  const start = new Date(Date.UTC(2026, 9, 1, 14, 0))
  const got = occurrences(rule("FREQ=DAILY;COUNT=2"), start, true, OCT, NOV)
  assert.deepEqual(
    got.map((d) => d.toISOString()),
    ["2026-10-01T14:00:00.000Z", "2026-10-02T14:00:00.000Z"],
  )
})

test("an unsupported frequency is not a rule", () => {
  assert.equal(parseRule("FREQ=HOURLY", local), null)
})
