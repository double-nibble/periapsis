import assert from "node:assert/strict"
import { test } from "node:test"
import { claudeArgs, extractJson, permissionMode } from "./run.js"
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

test("claudeArgs defaults to dontAsk and denies builtins plus connector writes", () => {
  const args = claudeArgs({ prompt: "", tools: ["mcp__a__read"], deny: ["mcp__a__write"] })
  assert.equal(args[args.indexOf("--permission-mode") + 1], "dontAsk")
  const denied = args[args.indexOf("--disallowedTools") + 1]?.split(",") ?? []
  assert.ok(denied.includes("Bash"))
  assert.ok(denied.includes("mcp__a__write"))
  assert.equal(args[args.indexOf("--allowedTools") + 1], "mcp__a__read")
})

test("claudeArgs passes auto mode through", () => {
  const args = claudeArgs({ prompt: "", tools: [], permissionMode: "auto" })
  assert.equal(args[args.indexOf("--permission-mode") + 1], "auto")
})

test("permissionMode accepts dontAsk and auto only", () => {
  assert.equal(permissionMode(undefined), "dontAsk")
  assert.equal(permissionMode("auto"), "auto")
  assert.throws(() => permissionMode("bypassPermissions"))
})

test("built-in calendar and email sources deny their connector writes", () => {
  assert.ok(resolveSource("calendar").deny.includes("mcp__claude_ai_Google_Calendar__delete_event"))
  assert.ok(resolveSource("email").deny.includes("mcp__claude_ai_Gmail__send_message"))
})

test("params.deny extends a built-in source's deny list", () => {
  const spec = resolveSource("tickets", { deny: ["mcp__claude_ai_Linear__create_issue"] })
  assert.deepEqual(spec.deny, ["mcp__claude_ai_Linear__create_issue"])
})

test("the built-in messages source reads Slack and denies its writes", () => {
  const spec = resolveSource("messages")
  assert.ok(spec.tools.includes("mcp__claude_ai_Slack__slack_search_public_and_private"))
  assert.ok(spec.deny.includes("mcp__claude_ai_Slack__slack_send_message"))
})
