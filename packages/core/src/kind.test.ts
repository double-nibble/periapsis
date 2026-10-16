import assert from "node:assert/strict"
import { test } from "node:test"
import { KINDS, isKind } from "./kind.js"

test("every listed kind is recognized", () => {
  for (const k of KINDS) assert.ok(isKind(k))
})

test("unknown kinds are rejected", () => {
  assert.ok(!isKind("unknown"))
  assert.ok(!isKind(""))
  assert.ok(!isKind(null))
  assert.ok(!isKind(42))
})

test("the vocabulary is exactly the eight kinds", () => {
  assert.deepEqual([...KINDS].sort(), [
    "calendar",
    "doc",
    "email",
    "message",
    "pr",
    "project",
    "task",
    "ticket",
  ])
})
