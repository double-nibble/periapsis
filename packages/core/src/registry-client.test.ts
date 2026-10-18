import assert from "node:assert/strict"
import { test } from "node:test"
import { RegistryClient } from "./registry-client.js"
import { keygen, signRegistry } from "./registry.js"
import { generateIdentity } from "./sealed.js"

const root = generateIdentity()
const sub1 = keygen()

function signedDoc() {
  return signRegistry({ identities: { sub1: sub1.publicIdentity }, signedAt: 1 }, root.signPrivate)
}

function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return (async () =>
    ({ ok, status, json: async () => body }) as unknown as Response) as typeof fetch
}

test("loads and exposes identities from a valid signed registry", async () => {
  const c = new RegistryClient({
    url: "https://status.example.com/registry.json",
    rootSignPublic: root.signPublic,
    fetchImpl: fakeFetch(signedDoc()),
  })
  await c.start()
  c.stop()
  assert.ok(c.identity("sub1"))
  assert.equal(c.identity("nope"), null)
})

test("rejects a registry that fails signature verification", async () => {
  const fake = generateIdentity()
  const c = new RegistryClient({
    url: "https://status.example.com/registry.json",
    rootSignPublic: fake.signPublic, // wrong root
    fetchImpl: fakeFetch(signedDoc()),
  })
  await assert.rejects(() => c.start())
})

test("refuses a non-https url", async () => {
  const c = new RegistryClient({
    url: "http://status.example.com/registry.json",
    rootSignPublic: root.signPublic,
    fetchImpl: fakeFetch(signedDoc()),
  })
  await assert.rejects(() => c.start(), /https/)
})

test("a failed fetch with no cache rejects", async () => {
  const c = new RegistryClient({
    url: "https://status.example.com/registry.json",
    rootSignPublic: root.signPublic,
    fetchImpl: fakeFetch(null, false, 503),
  })
  await assert.rejects(() => c.start(), /registry.json returned HTTP 503/)
})

test("a network failure names the registry URL and the underlying cause", async () => {
  const c = new RegistryClient({
    url: "https://status.example.com/registry.json",
    rootSignPublic: root.signPublic,
    fetchImpl: (async () => {
      throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } })
    }) as typeof fetch,
  })
  await assert.rejects(
    () => c.start(),
    /cannot fetch the registry from https:\/\/status\.example\.com\/registry\.json: ENOTFOUND/,
  )
})
