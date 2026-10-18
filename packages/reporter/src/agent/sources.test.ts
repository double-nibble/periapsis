import assert from "node:assert/strict"
import { test } from "node:test"
import { isKind } from "@periapsis/core"
import { AGENT_SOURCES, buildPrompt, resolveSource } from "./sources.js"

test("every built-in source has a known kind, read tools, and instructions", () => {
  for (const [name, spec] of Object.entries(AGENT_SOURCES)) {
    assert.ok(isKind(spec.kind), `${name} kind`)
    assert.ok(spec.tools.length > 0, `${name} tools`)
    assert.ok(spec.instructions.length > 0, `${name} instructions`)
    for (const tool of spec.tools) assert.match(tool, /^mcp__claude_ai_/, `${name} tool ${tool}`)
  }
})

test("the built-ins cover the connector-backed types", () => {
  assert.deepEqual(Object.keys(AGENT_SOURCES).sort(), [
    "calendar",
    "docs",
    "email",
    "messages",
    "tickets",
  ])
})

test("resolveSource returns the built-in for a known source", () => {
  const spec = resolveSource("messages")
  assert.equal(spec.kind, "message")
})

test("inline params override the built-in (a provider of an existing type)", () => {
  const spec = resolveSource("messages", {
    tools: ["mcp__claude_ai_Discord__list_messages"],
    instructions: "report Discord mentions",
    kind: "message",
  })
  assert.deepEqual(spec.tools, ["mcp__claude_ai_Discord__list_messages"])
  assert.equal(spec.instructions, "report Discord mentions")
})

test("an unknown source with no inline spec is rejected", () => {
  assert.throws(() => resolveSource("doorbell"), /no agent source/)
})

test("buildPrompt carries the instructions and tools", () => {
  const spec = resolveSource("tickets")
  const { prompt, tools } = buildPrompt(spec, { account: "sub1", instance: "work" })
  assert.ok(prompt.includes("issues assigned to you"))
  assert.ok(prompt.includes("sub1"))
  assert.deepEqual(tools, spec.tools)
})

test("the calendar and email sources allow their connectors' read tools", () => {
  assert.ok(
    AGENT_SOURCES.calendar?.tools.includes("mcp__claude_ai_Google_Calendar__list_calendars"),
  )
  assert.deepEqual(AGENT_SOURCES.email?.tools, [
    "mcp__claude_ai_Gmail__search_threads",
    "mcp__claude_ai_Gmail__get_thread",
    "mcp__claude_ai_Gmail__get_message",
  ])
})
