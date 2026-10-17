import assert from "node:assert/strict"
import { test } from "node:test"
import { extractJson } from "./run.js"
import { buildPrompt, resolveSource } from "./sources.js"

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
  const { prompt, tools } = buildPrompt(resolveSource("calendar"), { openItems: [] })
  assert.match(prompt, /calendar name/)
  assert.match(prompt, /"openItems"/)
  assert.ok(tools.includes("mcp__claude_ai_Google_Calendar__list_events"))
})

test("resolveSource builds a source from inline tools and instructions", () => {
  const spec = resolveSource("email", {
    tools: ["mcp__yahoo__search"],
    instructions: "report unread mail",
    kind: "email",
  })
  assert.equal(spec.kind, "email")
  assert.deepEqual(spec.tools, ["mcp__yahoo__search"])
})

test("resolveSource rejects an unknown source with no inline spec", () => {
  assert.throws(() => resolveSource("nope"))
})
