import assert from "node:assert/strict"
import { test } from "node:test"
import { type Envelope, keygen, open } from "@periapsis/core"
import { MemoryBroker } from "@periapsis/transport"
import { publishStatus } from "./publish.js"

test("publishStatus seals a snapshot the hub can open", async () => {
  const hub = keygen()
  const sub1 = keygen()
  const broker = new MemoryBroker()
  let received: Envelope | null = null
  await broker.subscribe("status.sub1", (data) => {
    received = JSON.parse(new TextDecoder().decode(data))
  })
  await publishStatus(
    broker,
    { account: "sub1", signPrivate: sub1.identity.signPrivate, hub: hub.publicIdentity },
    { account: "sub1", source: "github", items: [] },
  )
  assert.ok(received)
  const payload = open(
    received as Envelope,
    hub.identity.boxPrivate,
    sub1.publicIdentity.signPublic,
  )
  assert.deepEqual(payload, { account: "sub1", source: "github", items: [] })
})
