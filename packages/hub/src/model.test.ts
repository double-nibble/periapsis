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
