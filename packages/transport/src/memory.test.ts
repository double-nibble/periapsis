import assert from "node:assert/strict"
import { test } from "node:test"
import { MemoryBroker, subjectMatches } from "./memory.ts"

test("exact subject matches", () => {
  assert.ok(subjectMatches("status.sub1", "status.sub1"))
  assert.ok(!subjectMatches("status.sub1", "status.sub2"))
})

test("wildcard token and tail match", () => {
  assert.ok(subjectMatches("status.*", "status.sub1"))
  assert.ok(subjectMatches("status.>", "status.sub1"))
  assert.ok(subjectMatches("status.>", "status.sub1.pr"))
  assert.ok(!subjectMatches("status.*", "status.sub1.pr"))
})

test("publish reaches a matching subscriber", async () => {
  const b = new MemoryBroker()
  const got: string[] = []
  await b.subscribe("status.>", (data, subject) =>
    got.push(`${subject}:${Buffer.from(data).toString()}`),
  )
  await b.publish("status.sub1", new TextEncoder().encode("hi"))
  await b.publish("other.x", new TextEncoder().encode("no"))
  assert.deepEqual(got, ["status.sub1:hi"])
})

test("unsubscribe stops delivery", async () => {
  const b = new MemoryBroker()
  let count = 0
  const sub = await b.subscribe("x", () => count++)
  await b.publish("x", new Uint8Array())
  sub.unsubscribe()
  await b.publish("x", new Uint8Array())
  assert.equal(count, 1)
})
