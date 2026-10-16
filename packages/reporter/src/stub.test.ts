import assert from "node:assert/strict"
import { test } from "node:test"
import { validateSnapshot } from "@periapsis/core"
import { MemoryBroker } from "@periapsis/transport"
import { FIXTURES } from "./fixtures.js"
import { runStub } from "./stub.js"

test("every fixture is a valid snapshot", () => {
  for (const f of FIXTURES) assert.ok(validateSnapshot(f, 1))
})

test("stub publishes all fixtures once on start", async () => {
  const broker = new MemoryBroker()
  const got: string[] = []
  await broker.subscribe("status.>", (_d, subject) => got.push(subject))
  const stub = await runStub(broker, 1_000_000)
  stub.stop()
  assert.equal(got.length, FIXTURES.length)
})

test("fixtures cover two accounts and a calendar kind", () => {
  const accounts = new Set(FIXTURES.map((f) => f.account))
  assert.deepEqual([...accounts].sort(), ["sub1", "sub2"])
  const kinds = new Set(FIXTURES.flatMap((f) => f.items.map((i) => (i as { kind: string }).kind)))
  assert.ok(kinds.has("calendar"))
})
