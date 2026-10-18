import assert from "node:assert/strict"
import { test } from "node:test"
import { type Envelope, type RegistryClient, generateIdentity, open } from "@periapsis/core"
import { MemoryBroker } from "@periapsis/transport"
import { commander } from "./commander.js"
import type { Row } from "./store.js"

const row: Row = {
  account: "sub1",
  source: "github",
  key: "pr/42",
  kind: "pr",
  title: "Fix the thing",
  detail: null,
  body: null,
  url: "https://github.com/o/r/pull/42",
  grp: null,
  priority: 2,
  fingerprint: "f",
  status: "active",
  hidden_until: null,
  resolved_at: null,
  meta: '{"instance":"gh"}',
}

test("commander seals a respond command only the account can open, signed by the hub", async () => {
  const hub = generateIdentity()
  const sub1 = generateIdentity()
  const registry = {
    identity: (a: string) => (a === "sub1" ? sub1 : undefined),
  } as unknown as RegistryClient
  const broker = new MemoryBroker()
  const got: { subject: string; env: Envelope }[] = []
  await broker.subscribe("commands.>", (data, subject) => {
    got.push({ subject, env: JSON.parse(new TextDecoder().decode(data)) })
  })
  const id = await commander(broker, registry, hub.signPrivate)(row, "Summarize it")
  assert.equal(got[0]?.subject, "commands.sub1")
  const env = got[0]?.env as Envelope
  const cmd = open(env, sub1.boxPrivate, hub.signPublic) as Record<string, unknown>
  assert.equal(cmd.id, id)
  assert.equal(cmd.prompt, "Summarize it")
  assert.equal((cmd.item as { meta: { instance: string } }).meta.instance, "gh")
  assert.throws(() => open(env, sub1.boxPrivate, sub1.signPublic))
})

test("commander refuses an account missing from the registry", async () => {
  const registry = { identity: () => undefined } as unknown as RegistryClient
  const send = commander(new MemoryBroker(), registry, generateIdentity().signPrivate)
  await assert.rejects(send(row, "x"), /not in the registry/)
})
