import assert from "node:assert/strict"
import { test } from "node:test"
import { STATUS_WILDCARD, commandSubject, statusSubject } from "./subjects.js"

test("status subject for an account", () => {
  assert.equal(statusSubject("sub1"), "status.sub1")
})

test("command subject for an account", () => {
  assert.equal(commandSubject("sub1"), "commands.sub1")
})

test("hub subscribes the status wildcard", () => {
  assert.equal(STATUS_WILDCARD, "status.>")
})

test("invalid account id throws instead of a malformed subject", () => {
  assert.throws(() => statusSubject("Sub.1"))
  assert.throws(() => commandSubject(""))
})
