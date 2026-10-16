import assert from "node:assert/strict"
import { test } from "node:test"
import { type Registry, RegistryClient, keygen, seal, signRegistry } from "@periapsis/core"
import { MemoryBroker } from "@periapsis/transport"
import { openStore } from "./store.js"
import { startSubscriber } from "./subscriber.js"

const hub = keygen()
const sub1 = keygen()
const sub2 = keygen()
const root = keygen()

async function registry(): Promise<RegistryClient> {
  const reg: Registry = {
    identities: { sub1: sub1.publicIdentity, sub2: sub2.publicIdentity },
    signedAt: 1,
  }
  const doc = signRegistry(reg, root.identity.signPrivate)
  const client = new RegistryClient({
    url: "https://status.example.com/r.json",
    rootSignPublic: root.identity.signPublic,
    fetchImpl: (async () => ({
      ok: true,
      status: 200,
      json: async () => doc,
    })) as unknown as typeof fetch,
  })
  await client.start()
  client.stop()
  return client
}

function sealedSnapshot(from: typeof sub1, body: object) {
  const env = seal(
    body,
    from === sub1 ? "sub1" : "sub2",
    from.identity.signPrivate,
    hub.publicIdentity.boxPublic,
  )
  return new TextEncoder().encode(JSON.stringify(env))
}

test("a sealed snapshot from a known reporter ingests", async () => {
  const broker = new MemoryBroker()
  const store = openStore(":memory:")
  const reg = await registry()
  await startSubscriber({ broker, store, registry: reg, hubBoxPrivate: hub.identity.boxPrivate })
  await broker.publish(
    "status.sub1",
    sealedSnapshot(sub1, {
      account: "sub1",
      source: "github",
      items: [{ key: "a", kind: "pr", title: "t", fingerprint: "f" }],
    }),
  )
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(store.list().length, 1)
  assert.equal(store.list()[0]?.account, "sub1")
  store.close()
})

test("an envelope from an unknown identity is dropped", async () => {
  const broker = new MemoryBroker()
  const store = openStore(":memory:")
  const reg = await registry()
  const errors: unknown[] = []
  await startSubscriber({
    broker,
    store,
    registry: reg,
    hubBoxPrivate: hub.identity.boxPrivate,
    onError: (e) => errors.push(e),
  })
  const stranger = keygen()
  const env = seal(
    { account: "subX", source: "github", items: [] },
    "subX",
    stranger.identity.signPrivate,
    hub.publicIdentity.boxPublic,
  )
  await broker.publish("status.subX", new TextEncoder().encode(JSON.stringify(env)))
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(errors.length, 1)
  assert.equal(store.list().length, 0)
  store.close()
})

test("a tampered envelope is dropped without stalling others", async () => {
  const broker = new MemoryBroker()
  const store = openStore(":memory:")
  const reg = await registry()
  await startSubscriber({ broker, store, registry: reg, hubBoxPrivate: hub.identity.boxPrivate })
  // garbage envelope
  await broker.publish("status.sub1", new TextEncoder().encode("{not an envelope"))
  await broker.publish(
    "status.sub2",
    sealedSnapshot(sub2, {
      account: "sub2",
      source: "jira",
      items: [{ key: "x", kind: "ticket", title: "t", fingerprint: "f" }],
    }),
  )
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(store.list().length, 1)
  assert.equal(store.list()[0]?.account, "sub2")
  store.close()
})
