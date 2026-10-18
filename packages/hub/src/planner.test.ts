import assert from "node:assert/strict"
import { test } from "node:test"
import type { RunResult } from "@periapsis/core"
import { buildModel } from "./model.js"
import { type Briefing, Planner, parseBriefing, planArgs, planContext } from "./planner.js"
import type { Row } from "./store.js"

function row(over: Partial<Row>): Row {
  return {
    account: "personal",
    source: "messages",
    key: "k",
    kind: "message",
    title: "Reply to Dana",
    detail: null,
    body: null,
    url: null,
    grp: null,
    priority: 1,
    fingerprint: "f",
    status: "active",
    hidden_until: null,
    resolved_at: null,
    meta: "{}",
    ...over,
  }
}

const NOW = new Date(2026, 9, 18, 10, 0)

function model() {
  return buildModel(
    [
      row({}),
      row({
        account: "work",
        source: "calendar",
        kind: "calendar",
        key: "today",
        title: "1:1 with William",
        meta: JSON.stringify({ at: new Date(2026, 9, 18, 14).toISOString() }),
      }),
      row({
        account: "work",
        source: "calendar",
        kind: "calendar",
        key: "next-week",
        title: "Offsite",
        meta: JSON.stringify({ at: new Date(2026, 9, 25, 9).toISOString() }),
      }),
    ],
    NOW.getTime(),
  )
}

test("planContext carries what needs the operator and only today's and tomorrow's events", () => {
  const ctx = planContext(model(), NOW)
  assert.deepEqual(ctx.accounts, ["personal", "work"])
  assert.equal(ctx.needs[0]?.title, "Reply to Dana")
  assert.deepEqual(
    ctx.calendar.map((e) => e.title),
    ["1:1 with William"],
  )
})

test("planArgs gives Claude no tools", () => {
  const args = planArgs()
  assert.equal(args[args.indexOf("--permission-mode") + 1], "dontAsk")
  assert.ok(args.includes("--strict-mcp-config"))
  assert.equal(args.includes("--allowedTools"), false)
})

test("parseBriefing keeps known accounts and drops empty steps", () => {
  const b = parseBriefing(
    '```json\n{"headline":"Ship it","steps":[{"text":"Merge #261","account":"personal"},{"text":"x","account":"nope"},{"text":""}]}\n```',
    ["personal"],
  )
  assert.equal(b.headline, "Ship it")
  assert.deepEqual(b.steps, [
    { text: "Merge #261", account: "personal" },
    { text: "x", account: null },
  ])
  assert.throws(() => parseBriefing('{"steps":[]}', []), /no headline/)
})

function planner(result: Partial<RunResult> | Error, saved: Briefing[], now = NOW.getTime()) {
  return new Planner(
    model,
    (b) => saved.push(b),
    () => saved.at(-1) ?? null,
    { everyHours: 3 },
    async () => {
      if (result instanceof Error) throw result
      return { result: "", isError: false, costUsd: null, turns: null, ...result }
    },
    () => now,
  )
}

test("a run saves the plan, and the next is due after the interval", async () => {
  const saved: Briefing[] = []
  const p = planner(
    { result: '{"headline":"Ship it","steps":[{"text":"Merge","account":"work"}]}' },
    saved,
  )
  assert.equal(p.due(), true)
  await p.run()
  assert.equal(saved[0]?.headline, "Ship it")
  assert.equal(saved[0]?.error, null)
  assert.equal(p.due(), false)
  const later = planner({}, saved, NOW.getTime() + 3 * 3_600_000)
  assert.equal(later.due(), true)
})

test("a failed run keeps the last plan, notes why, and retries in half an hour", async () => {
  const saved: Briefing[] = [{ at: 0, headline: "Old", steps: [], error: null }]
  const missing = Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" })
  await planner(missing, saved).run()
  assert.equal(saved.at(-1)?.headline, "Old")
  assert.equal(saved.at(-1)?.error, "claude is not installed on the hub machine")
  assert.equal(planner({}, saved, NOW.getTime() + 29 * 60_000).due(), false)
  assert.equal(planner({}, saved, NOW.getTime() + 30 * 60_000).due(), true)
})
