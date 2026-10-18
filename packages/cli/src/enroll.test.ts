import assert from "node:assert/strict"
import { test } from "node:test"
import type { Registry } from "@periapsis/core"
import {
  type AccountsMap,
  accountsConf,
  applyEnrollment,
  buildEnrollment,
  decodeEnrollment,
  encodeEnrollment,
  natsPublicFromSeed,
  newNatsUser,
  permissionsFor,
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

test("permissionsFor locks a reporter to its own subjects; hub sees the fleet", () => {
  assert.ok(permissionsFor("hub").includes('publish: ["commands.>"]'))
  assert.ok(permissionsFor("hub").includes('subscribe: ["status.>"'))
  const sub = permissionsFor("sub1")
  assert.ok(sub.includes('publish: ["status.sub1"]'))
  assert.ok(sub.includes('subscribe: ["commands.sub1"'))
})

test("accountsConf emits one nkey user per account, sorted, no passwords", () => {
  const conf = accountsConf({
    sub1: { nkey: "USUB1" },
    hub: { nkey: "UHUB" },
  })
  assert.ok(conf.includes("authorization {"))
  assert.ok(conf.includes('{ nkey: "UHUB", permissions:'))
  assert.ok(conf.includes('{ nkey: "USUB1", permissions:'))
  assert.ok(!conf.includes("password"))
  // hub sorts before sub1
  assert.ok(conf.indexOf("UHUB") < conf.indexOf("USUB1"))
})

test("an enrollment token is shell-safe and round-trips", () => {
  const { blob } = buildEnrollment("sub1")
  const token = encodeEnrollment(blob)
  assert.match(token, /^[A-Za-z0-9_-]+$/)
  assert.deepEqual(decodeEnrollment(`  ${token}\n`), blob)
})

test("decodeEnrollment also accepts the raw JSON", () => {
  const { blob } = buildEnrollment("sub1")
  assert.deepEqual(decodeEnrollment(JSON.stringify(blob)), blob)
})
