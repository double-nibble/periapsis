import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { loadInstances } from "./instances.js"

const one = [{ instance: "cal", source: "calendar", mode: "agent" }]

test("inline instances are used as they are", () => {
  assert.deepEqual(loadInstances(one, "/x/config.json").instances, one)
  assert.deepEqual(loadInstances(undefined, "/x/config.json").instances, [])
})

test("a path is read relative to the config file, fresh each time", () => {
  const dir = mkdtempSync(join(tmpdir(), "periapsis-"))
  const config = join(dir, "config.json")
  writeFileSync(join(dir, "instances.json"), "[]")
  assert.deepEqual(loadInstances("instances.json", config).instances, [])
  writeFileSync(join(dir, "instances.json"), JSON.stringify(one))
  const loaded = loadInstances("instances.json", config)
  assert.deepEqual(loaded.instances, one)
  assert.equal(loaded.from, join(dir, "instances.json"))
})

test("a missing or malformed instances file names the file", () => {
  const dir = mkdtempSync(join(tmpdir(), "periapsis-"))
  const config = join(dir, "config.json")
  assert.throws(
    () => loadInstances("instances.json", config),
    /cannot read instances from .*instances\.json/,
  )
  writeFileSync(join(dir, "instances.json"), '{"instance":"cal"}')
  assert.throws(() => loadInstances("instances.json", config), /must be a JSON array/)
  assert.throws(() => loadInstances(42, config), /must be an array or a path/)
})
