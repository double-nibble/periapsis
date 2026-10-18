import assert from "node:assert/strict"
import { test } from "node:test"
import { NatsBroker, connectFailure, connectOptions } from "./nats.js"

// Integration test: runs only when NATS_WS_URL is set (a ws:// or wss:// URL),
// otherwise skipped, so CI stays green without a broker.
const url = process.env.NATS_WS_URL

test("publish and subscribe round-trip over websocket", { skip: !url }, async () => {
  const b = await NatsBroker.connect({ servers: url as string })
  const got: string[] = []
  await b.subscribe("status.>", (data, subject) =>
    got.push(`${subject}:${Buffer.from(data).toString()}`),
  )
  await b.publish("status.sub1", new TextEncoder().encode("hi"))
  await new Promise((r) => setTimeout(r, 100))
  assert.deepEqual(got, ["status.sub1:hi"])
  await b.close()
})

test("a fresh connection resumes after reconnect", { skip: !url }, async () => {
  const b = await NatsBroker.connect({ servers: url as string })
  const got: string[] = []
  await b.subscribe("x.>", (data) => got.push(Buffer.from(data).toString()))
  await b.publish("x.one", new TextEncoder().encode("a"))
  await new Promise((r) => setTimeout(r, 100))
  await b.publish("x.two", new TextEncoder().encode("b"))
  await new Promise((r) => setTimeout(r, 100))
  assert.deepEqual(got, ["a", "b"])
  await b.close()
})

test("connectOptions uses an nkey authenticator when a seed is given, and no password", () => {
  const opts = connectOptions({ servers: "wss://b", nkeySeed: "SUACSOMESEED", pass: "nope" })
  assert.equal(typeof opts.authenticator, "function")
  assert.equal(opts.pass, undefined)
  assert.equal(opts.user, undefined)
})

test("connectOptions falls back to user/password when no seed is given", () => {
  const opts = connectOptions({ servers: "wss://b", user: "sub1", pass: "pw" })
  assert.equal(opts.authenticator, undefined)
  assert.equal(opts.user, "sub1")
  assert.equal(opts.pass, "pw")
})

test("connectFailure names the likely causes when the error has no message", () => {
  assert.match(connectFailure(new Error("")), /handshake failed.*TLS certificate/)
  assert.match(connectFailure(undefined), /handshake failed/)
  assert.equal(connectFailure(new Error("Authorization Violation")), "Authorization Violation")
})

test("connect reports which broker it could not reach", async () => {
  await assert.rejects(
    NatsBroker.connect({ servers: "ws://127.0.0.1:1" }),
    /cannot connect to ws:\/\/127\.0\.0\.1:1: \S/,
  )
})
