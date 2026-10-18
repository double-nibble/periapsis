import assert from "node:assert/strict"
import { test } from "node:test"
import { validateCommand } from "./command.js"

const ok = {
  id: "0f6c2d1e-aaaa-bbbb",
  type: "respond",
  account: "sub2",
  prompt: "Summarize the PR and recommend a review.",
  item: {
    source: "github",
    key: "pr/42",
    kind: "pr",
    title: "Fix the thing",
    url: "https://github.com/o/r/pull/42",
    meta: { instance: "gh", n: 3 },
  },
}

test("validateCommand accepts a respond command", () => {
  const c = validateCommand(ok)
  assert.equal(c.item.url, "https://github.com/o/r/pull/42")
  assert.deepEqual(c.item.meta, { instance: "gh" })
  assert.equal(c.item.body, null)
})

test("validateCommand rejects unknown types, bad ids and missing prompts", () => {
  assert.throws(() => validateCommand({ ...ok, type: "exec" }))
  assert.throws(() => validateCommand({ ...ok, id: "x" }))
  assert.throws(() => validateCommand({ ...ok, prompt: "" }))
  assert.throws(() => validateCommand({ ...ok, account: "Bad Acct" }))
})

test("validateCommand rejects an over-long prompt rather than cutting it", () => {
  assert.throws(() => validateCommand({ ...ok, prompt: "x".repeat(8_001) }), /over 8000/)
})

test("validateCommand drops a link to a non-allowlisted host", () => {
  const c = validateCommand({ ...ok, item: { ...ok.item, url: "https://evil.example/x" } })
  assert.equal(c.item.url, null)
})
