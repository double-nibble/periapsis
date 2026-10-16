import assert from "node:assert/strict"
import { test } from "node:test"
import { generateKeypair, sign, verify } from "./signing.ts"

test("sign and verify round-trip", () => {
  const { privateKey, publicKey } = generateKeypair()
  const payload = { account: "sub1", action: "refresh", nonce: 7 }
  const sig = sign(payload, privateKey)
  assert.ok(verify(payload, sig, publicKey))
})

test("tampered payload fails verification", () => {
  const { privateKey, publicKey } = generateKeypair()
  const sig = sign({ action: "a", nonce: 1 }, privateKey)
  assert.ok(!verify({ action: "a", nonce: 2 }, sig, publicKey))
})

test("wrong key fails verification", () => {
  const a = generateKeypair()
  const b = generateKeypair()
  const payload = { x: 1 }
  const sig = sign(payload, a.privateKey)
  assert.ok(!verify(payload, sig, b.publicKey))
})

test("key order does not change the signature", () => {
  const { privateKey, publicKey } = generateKeypair()
  const sig = sign({ a: 1, b: 2 }, privateKey)
  assert.ok(verify({ b: 2, a: 1 }, sig, publicKey))
})
