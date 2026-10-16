import assert from "node:assert/strict"
import { test } from "node:test"
import { SealError, generateIdentity, open, seal } from "./sealed.js"

test("round-trip: recipient opens with box private + sender sign public", () => {
  const alice = generateIdentity()
  const bob = generateIdentity()
  const env = seal({ action: "refresh" }, "alice", alice.signPrivate, bob.boxPublic)
  const got = open(env, bob.boxPrivate, alice.signPublic)
  assert.deepEqual(got, { action: "refresh" })
})

test("wrong recipient cannot decrypt", () => {
  const alice = generateIdentity()
  const bob = generateIdentity()
  const eve = generateIdentity()
  const env = seal({ x: 1 }, "alice", alice.signPrivate, bob.boxPublic)
  assert.throws(() => open(env, eve.boxPrivate, alice.signPublic), SealError)
})

test("wrong sender key fails signature", () => {
  const alice = generateIdentity()
  const bob = generateIdentity()
  const mallory = generateIdentity()
  const env = seal({ x: 1 }, "alice", alice.signPrivate, bob.boxPublic)
  assert.throws(() => open(env, bob.boxPrivate, mallory.signPublic), SealError)
})

test("tampered ciphertext fails", () => {
  const alice = generateIdentity()
  const bob = generateIdentity()
  const env = seal({ x: 1 }, "alice", alice.signPrivate, bob.boxPublic)
  const bad = { ...env, ciphertext: Buffer.from("tampered").toString("base64") }
  assert.throws(() => open(bad, bob.boxPrivate, alice.signPublic), SealError)
})

test("replayed nonce rejected", () => {
  const alice = generateIdentity()
  const bob = generateIdentity()
  const seen = new Set<string>()
  const env = seal({ x: 1 }, "alice", alice.signPrivate, bob.boxPublic)
  open(env, bob.boxPrivate, alice.signPublic, { seen })
  assert.throws(() => open(env, bob.boxPrivate, alice.signPublic, { seen }), SealError)
})

test("stale envelope rejected", () => {
  const alice = generateIdentity()
  const bob = generateIdentity()
  const env = seal({ x: 1 }, "alice", alice.signPrivate, bob.boxPublic)
  assert.throws(
    () => open(env, bob.boxPrivate, alice.signPublic, { now: env.at + 10 * 60_000 }),
    SealError,
  )
})
