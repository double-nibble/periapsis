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

function enroll(dir: string, token: string): string {
  return execFileSync(process.execPath, [cli, "enroll", token.trim(), "--root-key", "root.key"], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function hubToken(dir: string): string {
  return run(
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
}

function reporterToken(dir: string, account: string): string {
  return run(
    dir,
    "reporter-enroll",
    "--account",
    account,
    "--root-pub",
    "root.pub.json",
    "--broker",
    "wss://api.example.com",
    "--registry",
    "https://status.example.com/registry.json",
    "--out",
    `${account}-config.json`,
  )
}

test("enrolling the hub and a reporter yields a signed registry and nkey auth", () => {
  const dir = mkdtempSync(join(tmpdir(), "periapsis-"))
  run(dir, "keygen", "root")
  run(dir, "keygen", "hub")
  enroll(dir, hubToken(dir))
  enroll(dir, reporterToken(dir, "sub1"))
  const signed = JSON.parse(readFileSync(join(dir, "signed-registry.json"), "utf8"))
  const rootPub = JSON.parse(readFileSync(join(dir, "root.pub.json"), "utf8"))
  assert.ok(verifyRegistry(signed, rootPub.root.signPublic))
  assert.deepEqual(Object.keys(signed.registry.identities).sort(), ["hub", "sub1"])
  const sub1Seed = JSON.parse(readFileSync(join(dir, "sub1-config.json"), "utf8")).natsSeed
  assert.ok(sub1Seed.startsWith("SU"))
  run(dir, "broker-accounts", "--registry-file", "signed-registry.json")
  const conf = readFileSync(join(dir, "accounts.conf"), "utf8")
  assert.ok(conf.includes(`nkey: "${signed.registry.identities.hub.nkey}"`))
  assert.ok(conf.includes(`nkey: "${signed.registry.identities.sub1.nkey}"`))
  assert.ok(conf.includes('publish: ["status.sub1"]'))
  assert.ok(!conf.includes("password"))
})

test("re-enrolling an account replaces its keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "periapsis-"))
  run(dir, "keygen", "root")
  run(dir, "keygen", "hub")
  enroll(dir, hubToken(dir))
  enroll(dir, reporterToken(dir, "sub1"))
  const before = JSON.parse(readFileSync(join(dir, "signed-registry.json"), "utf8"))
  execFileSync("rm", [join(dir, "sub1-config.json")])
  enroll(dir, reporterToken(dir, "sub1"))
  const after = JSON.parse(readFileSync(join(dir, "signed-registry.json"), "utf8"))
  assert.notEqual(after.registry.identities.sub1.nkey, before.registry.identities.sub1.nkey)
  assert.equal(after.registry.identities.hub.nkey, before.registry.identities.hub.nkey)
})

test("enroll refuses a registry that does not verify under the root key", () => {
  const dir = mkdtempSync(join(tmpdir(), "periapsis-"))
  run(dir, "keygen", "root")
  run(dir, "keygen", "hub")
  enroll(dir, hubToken(dir))
  const signed = JSON.parse(readFileSync(join(dir, "signed-registry.json"), "utf8"))
  signed.registry.identities.intruder = signed.registry.identities.hub
  writeFileSync(join(dir, "signed-registry.json"), JSON.stringify(signed))
  assert.throws(() => enroll(dir, reporterToken(dir, "sub1")))
})

test("broker-accounts refuses a registry without the hub", () => {
  const dir = mkdtempSync(join(tmpdir(), "periapsis-"))
  run(dir, "keygen", "root")
  enroll(dir, reporterToken(dir, "sub1"))
  assert.throws(() => run(dir, "broker-accounts", "--registry-file", "signed-registry.json"))
})
