import assert from "node:assert/strict"
import { test } from "node:test"
import { extractJson } from "./run.js"
import { buildPrompt } from "./sources.js"

test("extractJson reads the last fenced json block", () => {
  assert.deepEqual(extractJson('x\n```json\n{"items":[{"key":"a"}]}\n```\ny'), {
    items: [{ key: "a" }],
  })
})

test("extractJson falls back to the outermost braces", () => {
  assert.deepEqual(extractJson('hi {"ok":true} bye'), { ok: true })
})

test("extractJson throws on non-JSON", () => {
  assert.throws(() => extractJson("no json here"))
})

test("buildPrompt carries the source instructions, tools, and context", () => {
  const { prompt, tools } = buildPrompt("calendar", { openItems: [] })
  assert.match(prompt, /calendar name/)
  assert.match(prompt, /"openItems"/)
  assert.ok(tools.includes("mcp__claude_ai_Google_Calendar__list_events"))
})

test("buildPrompt rejects an unknown source", () => {
  assert.throws(() => buildPrompt("nope", {}))
})
