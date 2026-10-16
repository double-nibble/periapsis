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
