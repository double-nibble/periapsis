import assert from "node:assert/strict"
import { test } from "node:test"
import { type Envelope, keygen, open } from "@periapsis/core"
import { MemoryBroker } from "@periapsis/transport"
import type { Provider } from "./provider.js"
import { runOnce } from "./runtime.js"

const hub = keygen()
const sub = keygen()

function fakeProvider(source: string): Provider {
  return {
    source,
    async read(cfg) {
      return {
        items: [{ key: "1", kind: "ticket", title: `${source}:${cfg.instance}`, fingerprint: "f" }],
      }
    },
  }
}

async function captured(broker: MemoryBroker): Promise<Envelope[]> {
  const envs: Envelope[] = []
  await broker.subscribe("status.>", (data) =>
    envs.push(JSON.parse(new TextDecoder().decode(data))),
  )
  return envs
}

test("runs providers and publishes a sealed snapshot per source", async () => {
  const broker = new MemoryBroker()
  const envs = await captured(broker)
  const providers = new Map<string, Provider>([
    ["jira", { ...fakeProvider("jira"), source: "jira" }],
  ])
  await runOnce(broker, providers, {
    account: {
      account: "sub2",
      instances: [
        { provider: "jira", instance: "a", params: {} },
        { provider: "jira", instance: "b", params: {} },
      ],
    },
    signPrivate: sub.identity.signPrivate,
    hub: hub.publicIdentity,
  })
  assert.equal(envs.length, 1) // one source → one envelope
  const payload = open(
    envs[0] as Envelope,
    hub.identity.boxPrivate,
    sub.publicIdentity.signPublic,
  ) as { items: unknown[] }
  assert.equal(payload.items.length, 2) // two instances merged
})

test("an unknown provider is reported, others still publish", async () => {
  const broker = new MemoryBroker()
  const envs = await captured(broker)
  const errors: unknown[] = []
  const providers = new Map<string, Provider>([
    ["jira", { ...fakeProvider("jira"), source: "jira" }],
  ])
  await runOnce(
    broker,
    providers,
    {
      account: {
        account: "sub2",
        instances: [
          { provider: "jira", instance: "a", params: {} },
          { provider: "unknown", instance: "x", params: {} },
        ],
      },
      signPrivate: sub.identity.signPrivate,
      hub: hub.publicIdentity,
    },
    (e) => errors.push(e),
  )
  assert.equal(errors.length, 1)
  assert.equal(envs.length, 1)
})
