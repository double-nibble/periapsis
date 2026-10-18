import assert from "node:assert/strict"
import { test } from "node:test"
import { collectAgentInstance } from "./collect.js"
import type { RunResult } from "./run.js"

const inst = { instance: "mycal", source: "calendar", mode: "agent" as const }

function fakeRun(result: string, isError = false): () => Promise<RunResult> {
  return () => Promise.resolve({ result, isError, costUsd: null, turns: null })
}

test("collectAgentInstance maps agent items to namespaced calendar items", async () => {
  const reply = `\`\`\`json
{ "items": [ { "key": "ev1", "title": "Standup", "url": "https://calendar.google.com/x", "group": "Team", "priority": 2, "fingerprint": "f1", "at": "2026-10-17T09:00:00Z" } ] }
\`\`\``
  const items = await collectAgentInstance("sub2", "calendar", inst, fakeRun(reply))
  assert.equal(items.length, 1)
  assert.equal(items[0]?.kind, "calendar")
  assert.equal(items[0]?.key, "sub2:calendar:mycal/ev1")
  assert.equal(items[0]?.meta.at, "2026-10-17T09:00:00Z")
  assert.equal(items[0]?.url, "https://calendar.google.com/x")
})

test("collectAgentInstance drops a link to a non-allowlisted host", async () => {
  const reply = `\`\`\`json
{ "items": [ { "key": "e", "title": "t", "url": "https://evil.example/x", "fingerprint": "f" } ] }
\`\`\``
  const items = await collectAgentInstance("sub2", "calendar", inst, fakeRun(reply))
  assert.equal(items[0]?.url, null)
})

test("collectAgentInstance throws when the agent reports failure", async () => {
  await assert.rejects(
    collectAgentInstance(
      "sub2",
      "calendar",
      inst,
      fakeRun('{"failed":true,"note":"connector down"}'),
    ),
  )
})

test("collectAgentInstance carries an event's end and all-day flag", async () => {
  const reply = `\`\`\`json
{ "items": [
  { "key": "t", "title": "Sync", "fingerprint": "f", "at": "2026-10-17T09:00:00Z", "end": "2026-10-17T10:00:00Z" },
  { "key": "d", "title": "Trip", "fingerprint": "f", "at": "2026-10-16", "end": "2026-10-18", "allDay": true }
] }
\`\`\``
  const [timed, allDay] = await collectAgentInstance("sub2", "calendar", inst, fakeRun(reply))
  assert.equal(timed?.meta.end, "2026-10-17T10:00:00Z")
  assert.equal(timed?.meta.allDay, undefined)
  assert.equal(allDay?.meta.at, "2026-10-16")
  assert.equal(allDay?.meta.allDay, "true")
})
