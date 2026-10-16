import assert from "node:assert/strict"
import { test } from "node:test"
import { statusSubject } from "@periapsis/core"
import { MemoryBroker } from "@periapsis/transport"
import { openStore } from "./store.ts"
import { startSubscriber } from "./subscriber.ts"

function publish(broker: MemoryBroker, account: string, body: object) {
  return broker.publish(statusSubject(account), new TextEncoder().encode(JSON.stringify(body)))
}

test("a published snapshot lands in the store for the right account", async () => {
  const broker = new MemoryBroker()
  const store = openStore(":memory:")
  await startSubscriber(broker, store, () => 100)
  await publish(broker, "sub1", {
    account: "sub1",
    source: "github",
    items: [{ key: "a", kind: "pr", title: "t", fingerprint: "f" }],
  })
  assert.equal(store.list().length, 1)
  assert.equal(store.list()[0]?.account, "sub1")
  store.close()
})

test("a malformed snapshot is skipped without affecting others", async () => {
  const broker = new MemoryBroker()
  const store = openStore(":memory:")
  const errors: unknown[] = []
  await startSubscriber(
    broker,
    store,
    () => 1,
    (e) => errors.push(e),
  )
  await publish(broker, "sub1", { account: "sub1", source: "github" }) // no items, not failed
  await publish(broker, "sub2", {
    account: "sub2",
    source: "github",
    items: [{ key: "a", kind: "pr", title: "t", fingerprint: "f" }],
  })
  assert.equal(errors.length, 1)
  assert.equal(store.list().length, 1)
  assert.equal(store.list()[0]?.account, "sub2")
  store.close()
})

test("a failed snapshot does not resolve prior items", async () => {
  const broker = new MemoryBroker()
  const store = openStore(":memory:")
  await startSubscriber(broker, store, () => 1)
  await publish(broker, "sub1", {
    account: "sub1",
    source: "github",
    items: [{ key: "a", kind: "pr", title: "t", fingerprint: "f" }],
  })
  await publish(broker, "sub1", { account: "sub1", source: "github", failed: true })
  assert.equal(store.list()[0]?.status, "active")
  store.close()
})
