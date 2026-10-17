import assert from "node:assert/strict"
import { test } from "node:test"
import type { Item } from "@periapsis/core"
import { openStore } from "./store.js"

function one<T>(rows: T[]): T {
  const r = rows[0]
  if (!r) throw new Error("expected at least one row")
  return r
}

function item(account: string, source: string, key: string, over: Partial<Item> = {}): Item {
  return {
    key: `${account}:${source}:${key}`,
    kind: "pr",
    priority: 2,
    title: "t",
    detail: null,
    url: null,
    group: null,
    fingerprint: "f",
    meta: {},
    ...over,
  }
}

test("reconcile inserts then resolves missing items", () => {
  const s = openStore(":memory:")
  s.reconcile("sub1", "github", [item("sub1", "github", "a"), item("sub1", "github", "b")], 100)
  assert.equal(s.list().filter((r) => r.status === "active").length, 2)
  s.reconcile("sub1", "github", [item("sub1", "github", "a")], 200)
  const rows = s.list()
  assert.equal(rows.find((r) => r.key === "a")?.status, "active")
  assert.equal(rows.find((r) => r.key === "b")?.status, "resolved")
  s.close()
})

test("two accounts with the same source and key do not collide", () => {
  const s = openStore(":memory:")
  s.reconcile("sub1", "github", [item("sub1", "github", "x", { title: "one" })], 1)
  s.reconcile("sub2", "github", [item("sub2", "github", "x", { title: "two" })], 1)
  const rows = s.list()
  assert.equal(rows.length, 2)
  assert.equal(rows.find((r) => r.account === "sub1")?.title, "one")
  assert.equal(rows.find((r) => r.account === "sub2")?.title, "two")
  s.close()
})

test("a silent source resolves only its own items", () => {
  const s = openStore(":memory:")
  s.reconcile("sub1", "github", [item("sub1", "github", "g")], 1)
  s.reconcile("sub1", "slack", [item("sub1", "slack", "m")], 1)
  // github goes silent (empty), slack still reports
  s.reconcile("sub1", "github", [], 2)
  s.reconcile("sub1", "slack", [item("sub1", "slack", "m")], 2)
  const rows = s.list()
  assert.equal(rows.find((r) => r.source === "github")?.status, "resolved")
  assert.equal(rows.find((r) => r.source === "slack")?.status, "active")
  s.close()
})

test("meta round-trips as json", () => {
  const s = openStore(":memory:")
  s.reconcile("sub1", "jira", [item("sub1", "jira", "t", { meta: { instance: "alpha" } })], 1)
  assert.equal(JSON.parse(one(s.list()).meta).instance, "alpha")
  s.close()
})

test("act snooze and restore", () => {
  const s = openStore(":memory:")
  s.reconcile("sub1", "github", [item("sub1", "github", "a")], 1)
  s.act("sub1", "github", "a", "snooze", 10, 1000)
  assert.equal(one(s.list()).status, "snoozed")
  s.act("sub1", "github", "a", "restore", 20)
  assert.equal(one(s.list()).status, "active")
  s.close()
})

test("reconcile records a source heartbeat even with no items", () => {
  const s = openStore(":memory:")
  s.reconcile("sub1", "github", [], 500)
  assert.equal(s.list().length, 0)
  const reps = s.reporters()
  assert.equal(reps.length, 1)
  assert.equal(reps[0]?.account, "sub1")
  assert.equal(reps[0]?.source, "github")
  assert.equal(reps[0]?.lastSeen, 500)
})
