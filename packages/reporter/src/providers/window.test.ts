import assert from "node:assert/strict"
import { test } from "node:test"
import { monthWindow } from "./window.js"

test("monthWindow starts on a Sunday on/before the 1st and spans the month", () => {
  const { start, end } = monthWindow(new Date(2026, 9, 17)) // Oct 2026
  assert.equal(start.getDay(), 0)
  assert.ok(start <= new Date(2026, 9, 1))
  assert.ok(end > new Date(2026, 9, 31))
  assert.ok((end.getTime() - start.getTime()) / 86400000 >= 28)
})
