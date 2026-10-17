import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { loadProvider } from "./load.js"

test("loadProvider imports a module's default-exported provider", async () => {
  const dir = mkdtempSync(join(tmpdir(), "periapsis-prov-"))
  const file = join(dir, "bitbucket.mjs")
  writeFileSync(file, 'export default { source: "code", async read() { return { items: [] } } }\n')
  const provider = await loadProvider(file)
  assert.equal(provider.source, "code")
  assert.deepEqual(await provider.read({ instance: "x" }), { items: [] })
})

test("loadProvider rejects a module that does not export a provider", async () => {
  const dir = mkdtempSync(join(tmpdir(), "periapsis-prov-"))
  const file = join(dir, "bad.mjs")
  writeFileSync(file, "export default { nope: true }\n")
  await assert.rejects(loadProvider(file))
})
