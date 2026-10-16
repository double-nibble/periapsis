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

test("keygen writes a private key and prints a public identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "periapsis-"))
  const out = JSON.parse(run(dir, "keygen", "sub1"))
  assert.ok(out.sub1.signPublic.includes("PUBLIC KEY"))
  const priv = JSON.parse(readFileSync(join(dir, "sub1.key"), "utf8"))
  assert.ok(priv.signPrivate.includes("PRIVATE KEY"))
})

test("sign-registry produces a doc that verifies against the root public key", () => {
  const dir = mkdtempSync(join(tmpdir(), "periapsis-"))
  const rootPub = JSON.parse(run(dir, "keygen", "root"))
  const subPub = JSON.parse(run(dir, "keygen", "sub1"))
  const registry = { identities: { sub1: subPub.sub1 }, signedAt: Date.now() }
  writeFileSync(join(dir, "registry.json"), JSON.stringify(registry))
  const signed = JSON.parse(run(dir, "sign-registry", "root.key", "registry.json"))
  assert.ok(verifyRegistry(signed, rootPub.root.signPublic))
})
