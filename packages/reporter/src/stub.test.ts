import assert from "node:assert/strict"
import { test } from "node:test"
import { type Envelope, keygen, open, validateSnapshot } from "@periapsis/core"
import { MemoryBroker } from "@periapsis/transport"
import { FIXTURES } from "./fixtures.js"
import { runStub } from "./stub.js"

test("every fixture is a valid snapshot", () => {
  for (const f of FIXTURES) assert.ok(validateSnapshot(f, 1))
})

test("stub seals and publishes all fixtures the hub can open", async () => {
  const hub = keygen()
  const sub1 = keygen()
  const sub2 = keygen()
  const broker = new MemoryBroker()
  const opened: unknown[] = []
  await broker.subscribe("status.>", (data) => {
    const env = JSON.parse(new TextDecoder().decode(data)) as Envelope
    const sender = env.from === "sub1" ? sub1 : sub2
    opened.push(open(env, hub.identity.boxPrivate, sender.publicIdentity.signPublic))
  })
  const stub = await runStub(
    broker,
    {
      signPrivateByAccount: { sub1: sub1.identity.signPrivate, sub2: sub2.identity.signPrivate },
      hub: hub.publicIdentity,
    },
    1_000_000,
  )
  stub.stop()
  assert.equal(opened.length, FIXTURES.length)
})

test("fixtures cover two accounts and a calendar kind", () => {
  const accounts = new Set(FIXTURES.map((f) => f.account))
  assert.deepEqual([...accounts].sort(), ["sub1", "sub2"])
  const kinds = new Set(FIXTURES.flatMap((f) => f.items.map((i) => (i as { kind: string }).kind)))
  assert.ok(kinds.has("calendar"))
})
