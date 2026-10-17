import assert from "node:assert/strict"
import { test } from "node:test"
import type { Registry } from "@periapsis/core"
import {
  type AccountsMap,
  applyEnrollment,
  buildEnrollment,
  natsPublicFromSeed,
  newNatsUser,
} from "./enroll.js"

test("newNatsUser makes a user seed whose public key round-trips", () => {
  const u = newNatsUser()
  assert.ok(u.seed.startsWith("SU"))
  assert.ok(u.publicKey.startsWith("U"))
  assert.equal(natsPublicFromSeed(u.seed), u.publicKey)
})

test("buildEnrollment keeps privates in secrets and only publics in the blob", () => {
  const { secrets, blob } = buildEnrollment("sub1")
  assert.equal(secrets.account, "sub1")
  assert.ok(secrets.signPrivate.includes("PRIVATE"))
  assert.ok(secrets.natsSeed.startsWith("SU"))
  assert.equal(blob.account, "sub1")
  assert.ok(blob.identity.signPublic.includes("PUBLIC"))
  assert.ok(blob.nkey.startsWith("U"))
  // the blob must not carry any private material
  assert.ok(!JSON.stringify(blob).includes("PRIVATE"))
  assert.ok(!JSON.stringify(blob).includes(secrets.natsSeed))
})

test("applyEnrollment records the identity and nkey, replacing a prior entry", () => {
  const registry: Registry = { identities: {}, signedAt: 0 }
  const accounts: AccountsMap = {}
  const { blob } = buildEnrollment("sub1")
  applyEnrollment(registry, accounts, blob)
  assert.deepEqual(registry.identities.sub1, blob.identity)
  assert.equal(accounts.sub1?.nkey, blob.nkey)
  assert.ok(registry.signedAt > 0)
  const again = buildEnrollment("sub1")
  applyEnrollment(registry, accounts, again.blob)
  assert.equal(accounts.sub1?.nkey, again.blob.nkey)
  assert.equal(Object.keys(accounts).length, 1)
})
