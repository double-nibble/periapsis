import assert from "node:assert/strict"
import { test } from "node:test"
import { type Command, generateIdentity, seal } from "@periapsis/core"
import { MemoryBroker } from "@periapsis/transport"
import { startIntake } from "./intake.js"
import type { Responder } from "./responder.js"

const command = {
  id: "aaaaaaaa-1",
  type: "respond",
  account: "sub1",
  prompt: "Review it",
  item: { source: "code", key: "sub1:code:gh/1", kind: "pr", title: "t" },
}

async function setup() {
  const hub = generateIdentity()
  const sub1 = generateIdentity()
  const broker = new MemoryBroker()
  const handled: Command[] = []
  const errors: string[] = []
  const responder = { handle: async (c: Command) => void handled.push(c) } as unknown as Responder
  await startIntake({
    broker,
    account: "sub1",
    boxPrivate: sub1.boxPrivate,
    hub,
    responder,
    onError: (e) => errors.push((e as Error).message),
  })
  const send = (body: unknown, signer = hub.signPrivate, from = "hub") =>
    broker.publish(
      "commands.sub1",
      new TextEncoder().encode(JSON.stringify(seal(body, from, signer, sub1.boxPublic))),
    )
  return { send, handled, errors, sub1 }
}

test("a command signed by the hub is handled once", async () => {
  const { send, handled, errors } = await setup()
  await send(command)
  assert.equal(handled.length, 1)
  assert.equal(handled[0]?.prompt, "Review it")
  assert.deepEqual(errors, [])
})

test("a command not signed by the hub is refused", async () => {
  const { send, handled, errors } = await setup()
  await send(command, generateIdentity().signPrivate)
  assert.equal(handled.length, 0)
  assert.match(errors[0] ?? "", /bad signature/)
})

test("a command addressed to another account is refused", async () => {
  const { send, handled, errors } = await setup()
  await send({ ...command, account: "sub2" })
  assert.equal(handled.length, 0)
  assert.match(errors[0] ?? "", /for sub2/)
})
