import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { verifyRegistry } from "@periapsis/core"

const cli = join(fileURLToPath(new URL(".", import.meta.url)), "cli.js")

function run(cwd: string, ...args: string[]): string {
  return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" })
}

test("keygen writes a private key and a public identity file", () => {
  const dir = mkdtempSync(join(tmpdir(), "periapsis-"))
  run(dir, "keygen", "sub1")
  const priv = JSON.parse(readFileSync(join(dir, "sub1.key"), "utf8"))
  assert.ok(priv.signPrivate.includes("PRIVATE KEY"))
  const pub = JSON.parse(readFileSync(join(dir, "sub1.pub.json"), "utf8"))
  assert.ok(pub.sub1.signPublic.includes("PUBLIC KEY"))
})

test("keygen refuses to overwrite an existing key", () => {
  const dir = mkdtempSync(join(tmpdir(), "periapsis-"))
  run(dir, "keygen", "sub1")
  assert.throws(() => run(dir, "keygen", "sub1"))
})

test("sign-registry produces a doc that verifies against the root public key", () => {
  const dir = mkdtempSync(join(tmpdir(), "periapsis-"))
  run(dir, "keygen", "root")
  run(dir, "keygen", "sub1")
  const rootPub = JSON.parse(readFileSync(join(dir, "root.pub.json"), "utf8"))
  const subPub = JSON.parse(readFileSync(join(dir, "sub1.pub.json"), "utf8"))
  const registry = { identities: { sub1: subPub.sub1 }, signedAt: Date.now() }
  writeFileSync(join(dir, "registry.json"), JSON.stringify(registry))
  const signed = JSON.parse(run(dir, "sign-registry", "root.key", "registry.json"))
  assert.ok(verifyRegistry(signed, rootPub.root.signPublic))
})

test("registry-add merges a public identity into the registry", () => {
  const dir = mkdtempSync(join(tmpdir(), "periapsis-"))
  run(dir, "keygen", "sub1")
  run(dir, "keygen", "sub2")
  writeFileSync(join(dir, "registry.json"), JSON.stringify({ identities: {}, signedAt: 0 }))
  const updated = JSON.parse(run(dir, "registry-add", "registry.json", "sub2.pub.json"))
  assert.ok(updated.identities.sub2)
  assert.ok(updated.signedAt > 0)
})

test("hub-config assembles a config from the hub key and root public key", () => {
  const dir = mkdtempSync(join(tmpdir(), "periapsis-"))
  run(dir, "keygen", "root")
  run(dir, "keygen", "hub")
  run(
    dir,
    "hub-config",
    "--hub-key",
    "hub.key",
    "--root-pub",
    "root.pub.json",
    "--broker",
    "wss://api.example.com",
    "--registry",
    "https://status.example.com/registry.json",
  )
  const cfg = JSON.parse(readFileSync(join(dir, "hub-config.json"), "utf8"))
  const hub = JSON.parse(readFileSync(join(dir, "hub.key"), "utf8"))
  const rootPub = JSON.parse(readFileSync(join(dir, "root.pub.json"), "utf8"))
  assert.equal(cfg.brokerUrl, "wss://api.example.com")
  assert.equal(cfg.rootSignPublic, rootPub.root.signPublic)
  assert.equal(cfg.boxPrivate, hub.boxPrivate)
  assert.equal(cfg.port, 4747)
})

test("broker-accounts generates NATS auth config and creds including the hub", () => {
  const dir = mkdtempSync(join(tmpdir(), "periapsis-"))
  run(dir, "broker-accounts", "--accounts", "sub1,sub2")
  const conf = readFileSync(join(dir, "accounts.conf"), "utf8")
  assert.ok(conf.includes('user: "hub"'))
  assert.ok(conf.includes('publish: ["status.sub1"]'))
  assert.ok(conf.includes('subscribe: ["commands.sub1", "_INBOX.>"]'))
  assert.ok(conf.includes('subscribe: ["status.>", "_INBOX.>"]'))
  const creds = JSON.parse(readFileSync(join(dir, "broker-creds.json"), "utf8"))
  assert.ok(creds.hub && creds.sub1 && creds.sub2)
})

test("reporter-config assembles a reporter config from the account key", () => {
  const dir = mkdtempSync(join(tmpdir(), "periapsis-"))
  run(dir, "keygen", "root")
  run(dir, "keygen", "sub1")
  writeFileSync(
    join(dir, "instances.json"),
    JSON.stringify([{ provider: "github", instance: "mygh", params: { token: "T", login: "L" } }]),
  )
  run(
    dir,
    "reporter-config",
    "--account",
    "sub1",
    "--account-key",
    "sub1.key",
    "--root-pub",
    "root.pub.json",
    "--broker",
    "wss://api.example.com",
    "--registry",
    "https://status.example.com/registry.json",
    "--instances",
    "instances.json",
  )
  const cfg = JSON.parse(readFileSync(join(dir, "reporter-config.json"), "utf8"))
  const key = JSON.parse(readFileSync(join(dir, "sub1.key"), "utf8"))
  const rootPub = JSON.parse(readFileSync(join(dir, "root.pub.json"), "utf8"))
  assert.equal(cfg.account, "sub1")
  assert.equal(cfg.signPrivate, key.signPrivate)
  assert.equal(cfg.rootSignPublic, rootPub.root.signPublic)
  assert.equal(cfg.instances.length, 1)
  assert.equal(cfg.everyMs, 60000)
  assert.equal(cfg.brokerPass, undefined)
})

test("broker-accounts --keep preserves existing passwords and mints only new ones", () => {
  const dir = mkdtempSync(join(tmpdir(), "periapsis-"))
  run(dir, "broker-accounts", "--accounts", "sub1")
  const first = JSON.parse(readFileSync(join(dir, "broker-creds.json"), "utf8"))
  run(dir, "broker-accounts", "--accounts", "sub1,sub2", "--keep", "broker-creds.json")
  const second = JSON.parse(readFileSync(join(dir, "broker-creds.json"), "utf8"))
  assert.equal(second.hub, first.hub)
  assert.equal(second.sub1, first.sub1)
  assert.ok(second.sub2 && second.sub2 !== first.sub1)
})
