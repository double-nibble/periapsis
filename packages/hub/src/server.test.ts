import assert from "node:assert/strict"
import { test } from "node:test"
import type { Item } from "@periapsis/core"
import { startServer } from "./server.js"
import { openStore } from "./store.js"

function item(key: string): Item {
  return {
    key: `sub1:github:${key}`,
    kind: "pr",
    priority: 1,
    title: "t",
    detail: null,
    url: null,
    group: null,
    fingerprint: "f",
    meta: {},
  }
}

async function get(port: number, path: string) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`)
  return { status: res.status, body: await res.text() }
}

test("serves the model as json", async () => {
  const store = openStore(":memory:")
  store.reconcile("sub1", "github", [item("a")], 1)
  const hub = startServer(store, 14790, () => 1)
  await new Promise((r) => setTimeout(r, 50))
  const r = await get(14790, "/api/model")
  assert.equal(r.status, 200)
  const model = JSON.parse(r.body)
  assert.equal(model.accounts[0].account, "sub1")
  hub.close()
  store.close()
})

test("serves the index page", async () => {
  const store = openStore(":memory:")
  const hub = startServer(store, 14791, () => 1)
  await new Promise((r) => setTimeout(r, 50))
  const r = await get(14791, "/")
  assert.equal(r.status, 200)
  assert.ok(r.body.includes("periapsis"))
  hub.close()
  store.close()
})

async function post(
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-periapsis": "1", ...headers },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

test("act snoozes an item from the dashboard", async () => {
  const store = openStore(":memory:")
  store.reconcile("sub1", "github", [item("a")], 1)
  const hub = startServer(store, 14792, () => 10)
  await new Promise((r) => setTimeout(r, 50))
  const r = await post(14792, "/api/act", {
    account: "sub1",
    source: "github",
    key: "a",
    action: "snooze",
    until: 1000,
  })
  assert.equal(r.status, 200)
  assert.equal(store.get("sub1", "github", "a")?.status, "snoozed")
  hub.close()
  store.close()
})

test("a state change without the dashboard header is refused", async () => {
  const store = openStore(":memory:")
  store.reconcile("sub1", "github", [item("a")], 1)
  const hub = startServer(store, 14793, () => 10)
  await new Promise((r) => setTimeout(r, 50))
  const r = await post(
    14793,
    "/api/act",
    { account: "sub1", source: "github", key: "a", action: "done" },
    { "x-periapsis": "0" },
  )
  assert.equal(r.status, 403)
  assert.equal(store.get("sub1", "github", "a")?.status, "active")
  hub.close()
  store.close()
})

test("respond hands the item and prompt to the commander", async () => {
  const store = openStore(":memory:")
  store.reconcile("sub1", "github", [item("a")], 1)
  const sent: string[] = []
  const hub = startServer(store, 14794, () => 10, {
    respond: async (row, prompt) => {
      sent.push(`${row.key}:${prompt}`)
      return "id-1"
    },
  })
  await new Promise((r) => setTimeout(r, 50))
  const r = await post(14794, "/api/respond", {
    account: "sub1",
    source: "github",
    key: "a",
    prompt: " review it ",
  })
  assert.deepEqual(r.body, { id: "id-1" })
  assert.deepEqual(sent, ["a:review it"])
  const model = JSON.parse((await get(14794, "/api/model")).body)
  assert.deepEqual(model.commands, [
    {
      id: "id-1",
      at: 10,
      account: "sub1",
      source: "github",
      key: "a",
      title: "t",
      prompt: "review it",
      state: null,
      cost: null,
    },
  ])
  hub.close()
  store.close()
})

test("respond explains why it is unavailable", async () => {
  const store = openStore(":memory:")
  store.reconcile("sub1", "github", [item("a")], 1)
  const hub = startServer(store, 14795, () => 10, { respondUnavailable: "no key" })
  await new Promise((r) => setTimeout(r, 50))
  const r = await post(14795, "/api/respond", {
    account: "sub1",
    source: "github",
    key: "a",
    prompt: "x",
  })
  assert.equal(r.status, 503)
  assert.equal(r.body.error, "no key")
  hub.close()
  store.close()
})

test("plan asks for a new plan from the dashboard", async () => {
  const store = openStore(":memory:")
  let asked = 0
  const hub = startServer(store, 14796, () => 10, {
    plan: () => {
      asked += 1
    },
  })
  await new Promise((r) => setTimeout(r, 50))
  const r = await post(14796, "/api/plan", {})
  assert.equal(r.status, 200)
  assert.equal(asked, 1)
  hub.close()
  store.close()
})
