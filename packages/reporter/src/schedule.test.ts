import assert from "node:assert/strict"
import { test } from "node:test"
import { AGENT_DEFAULT_MS, formatInterval, intervalMs } from "./schedule.js"

test("every reads seconds, minutes, hours, or milliseconds", () => {
  assert.equal(intervalMs({ instance: "a", every: "30s" }, 60_000), 30_000)
  assert.equal(intervalMs({ instance: "a", every: "5m" }, 60_000), 300_000)
  assert.equal(intervalMs({ instance: "a", every: "1h" }, 60_000), 3_600_000)
  assert.equal(intervalMs({ instance: "a", every: "1.5h" }, 60_000), 5_400_000)
  assert.equal(intervalMs({ instance: "a", every: 120_000 }, 60_000), 120_000)
})

test("without every, a direct instance uses the reporter's interval and an agent one is slow", () => {
  assert.equal(intervalMs({ instance: "a", provider: "github" }, 60_000), 60_000)
  assert.equal(intervalMs({ instance: "a", mode: "agent" }, 60_000), AGENT_DEFAULT_MS)
})

test("an unreadable or too-short every names the instance", () => {
  assert.throws(
    () => intervalMs({ instance: "cal", every: "hourly" }, 60_000),
    /instance cal: every "hourly"/,
  )
  assert.throws(() => intervalMs({ instance: "cal", every: "5s" }, 60_000), /at least 10s/)
})

test("formatInterval prints the largest whole unit", () => {
  assert.deepEqual([3_600_000, 900_000, 45_000].map(formatInterval), ["1h", "15m", "45s"])
})
