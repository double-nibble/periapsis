import assert from "node:assert/strict"
import { test } from "node:test"
import { createLogger } from "./log.js"

function capture(fn: () => void): string {
  let out = ""
  const orig = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: string) => {
    out += chunk
    return true
  }) as unknown as typeof process.stderr.write
  try {
    fn()
  } finally {
    process.stderr.write = orig
  }
  return out
}

test("default level logs errors but suppresses debug", () => {
  process.env.PERIAPSIS_LOG = undefined
  const log = createLogger("t")
  const out = capture(() => {
    log.debug("d")
    log.error("e")
  })
  assert.ok(!out.includes(" DEBUG "))
  assert.ok(out.includes(" ERROR t e"))
})

test("debug level logs debug with fields", () => {
  process.env.PERIAPSIS_LOG = "debug"
  const log = createLogger("t")
  const out = capture(() => log.debug("hello", { k: 1 }))
  process.env.PERIAPSIS_LOG = undefined
  assert.ok(out.includes(" DEBUG t hello k=1"))
})
