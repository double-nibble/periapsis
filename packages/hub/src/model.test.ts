import assert from "node:assert/strict"
import { test } from "node:test"
import { aggregate, buildModel } from "./model.js"
import type { Row } from "./store.js"

function row(account: string, over: Partial<Row> = {}): Row {
  return {
    account,
    source: "github",
    key: "k",
    kind: "pr",
    title: "t",
    detail: null,
    body: null,
    url: null,
    grp: null,
    priority: 2,
    fingerprint: "f",
    status: "active",
    hidden_until: null,
    resolved_at: null,
    meta: "{}",
    ...over,
  }
}

test("a reporting account with no items still appears", () => {
  const m = buildModel([], 1, [{ account: "sub1", source: "github", lastSeen: 1 }])
  assert.equal(m.accounts.length, 1)
  assert.equal(m.accounts[0]?.account, "sub1")
  assert.equal(m.accounts[0]?.items.length, 0)
})

test("per-account model groups by account", () => {
  const m = buildModel([row("sub1", { key: "a" }), row("sub2", { key: "b" })], 1)
  assert.equal(m.accounts.length, 2)
  assert.equal(m.accounts[0]?.account, "sub1")
  assert.equal(m.accounts[1]?.account, "sub2")
})

test("only active rows appear", () => {
  const m = buildModel(
    [row("sub1", { key: "a" }), row("sub1", { key: "b", status: "resolved" })],
    1,
  )
  assert.equal(m.accounts[0]?.items.length, 1)
})

test("aggregate labels every item with its account", () => {
  const m = buildModel([row("sub1", { key: "a" }), row("sub2", { key: "b" })], 1)
  const all = aggregate(m)
  assert.equal(all.length, 2)
  assert.deepEqual(new Set(all.map((i) => i.account)), new Set(["sub1", "sub2"]))
})

test("schedule merges calendars across accounts in time order", () => {
  const m = buildModel(
    [
      row("sub2", {
        key: "e2",
        kind: "calendar",
        title: "late",
        meta: '{"at":"2026-01-01T15:00"}',
      }),
      row("sub1", {
        key: "e1",
        kind: "calendar",
        title: "early",
        meta: '{"at":"2026-01-01T09:00"}',
      }),
    ],
    1,
  )
  assert.equal(m.schedule.length, 2)
  assert.equal(m.schedule[0]?.title, "early")
  assert.equal(m.schedule[1]?.title, "late")
  assert.equal(m.schedule[0]?.account, "sub1")
})

test("items sort by priority", () => {
  const m = buildModel(
    [row("sub1", { key: "low", priority: 3 }), row("sub1", { key: "high", priority: 1 })],
    1,
  )
  assert.equal(m.accounts[0]?.items[0]?.key, "high")
})

test("a snoozed item returns when its snooze ends", () => {
  const rows = [row("sub1", { status: "snoozed", hidden_until: 100 })]
  assert.equal(buildModel(rows, 99).accounts.length, 0)
  assert.equal(buildModel(rows, 100).accounts[0]?.items.length, 1)
})

test("needs holds what the operator must act on, across accounts", () => {
  const m = buildModel(
    [
      row("sub1", { key: "pr-quiet", meta: '{"role":"author"}' }),
      row("sub1", { key: "pr-act", priority: 1, meta: '{"role":"author","action":"Merge it"}' }),
      row("sub2", { key: "cal", kind: "calendar", source: "calendar" }),
      row("sub2", { key: "msg", kind: "message", source: "messages" }),
    ],
    1,
  )
  assert.deepEqual(
    m.needs.map((i) => i.key),
    ["pr-act", "msg"],
  )
})

test("prs include hidden PRs with their status, and stats count them", () => {
  const now = new Date(2026, 9, 18, 12).getTime()
  const m = buildModel(
    [
      row("sub1", { key: "a", meta: '{"role":"author","action":"Merge it"}', priority: 1 }),
      row("sub1", { key: "b", meta: '{"role":"reviewer"}', status: "dismissed" }),
      row("sub1", { key: "c", status: "resolved", resolved_at: now - 3_600_000 }),
      row("sub1", { key: "d", kind: "message", status: "snoozed", hidden_until: now + 1000 }),
    ],
    now,
  )
  assert.deepEqual(
    m.prs.map((p) => [p.key, p.status]),
    [
      ["a", "active"],
      ["b", "dismissed"],
    ],
  )
  assert.deepEqual(m.stats, {
    now: 1,
    needs: 1,
    later: 1,
    resolvedToday: 1,
    openPrs: 1,
    toReview: 1,
  })
})

test("projects and RFCs have their own lists and need the operator only with an action", () => {
  const m = buildModel(
    [
      row("sub1", { key: "p1", kind: "project", source: "projects", meta: '{"health":"onTrack"}' }),
      row("sub1", {
        key: "p2",
        kind: "project",
        source: "projects",
        priority: 1,
        meta: '{"action":"Post a project update"}',
      }),
      row("sub1", { key: "d1", kind: "doc", source: "docs", status: "dismissed" }),
    ],
    1,
  )
  assert.deepEqual(
    m.projects.map((p) => p.key),
    ["p2", "p1"],
  )
  assert.deepEqual(
    m.docs.map((d) => [d.key, d.status]),
    [["d1", "dismissed"]],
  )
  assert.deepEqual(
    m.needs.map((i) => i.key),
    ["p2"],
  )
})
