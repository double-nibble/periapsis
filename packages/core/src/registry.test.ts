import assert from "node:assert/strict"
import { test } from "node:test"
import type { Registry } from "./registry.js"
import { keygen, lookup, signRegistry, verifyRegistry } from "./registry.js"
import { generateIdentity } from "./sealed.js"

function makeRegistry(): Registry {
  const sub1 = keygen()
  const sub2 = keygen()
  return {
    identities: { sub1: sub1.publicIdentity, sub2: sub2.publicIdentity },
    signedAt: 1000,
  }
}

test("keygen yields a public identity and a private keyset", () => {
  const k = keygen()
  assert.ok(k.publicIdentity.signPublic.includes("PUBLIC KEY"))
  assert.ok(k.identity.boxPrivate.includes("PRIVATE KEY"))
})

test("a registry signed by the root verifies against the root public key", () => {
  const root = generateIdentity()
  const doc = signRegistry(makeRegistry(), root.signPrivate)
  assert.ok(verifyRegistry(doc, root.signPublic))
})

test("a tampered registry fails verification", () => {
  const root = generateIdentity()
  const doc = signRegistry(makeRegistry(), root.signPrivate)
  const evil = keygen()
  doc.registry.identities.sub3 = evil.publicIdentity
  assert.ok(!verifyRegistry(doc, root.signPublic))
})

test("a registry signed by the wrong key fails", () => {
  const root = generateIdentity()
  const fake = generateIdentity()
  const doc = signRegistry(makeRegistry(), fake.signPrivate)
  assert.ok(!verifyRegistry(doc, root.signPublic))
})

test("lookup returns a public identity or null", () => {
  const reg = makeRegistry()
  assert.ok(lookup(reg, "sub1"))
  assert.equal(lookup(reg, "nope"), null)
})
