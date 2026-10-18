import assert from "node:assert/strict"
import { test } from "node:test"
import { urlProblem } from "./urls.js"

test("accepts broker and registry URLs", () => {
  assert.equal(urlProblem("wss://api.example.com", ["wss:", "ws:"], "--broker"), null)
  assert.equal(urlProblem("ws://127.0.0.1:4222", ["wss:", "ws:"], "--broker"), null)
  assert.equal(
    urlProblem("https://status.example.com/registry.json", ["https:"], "--registry"),
    null,
  )
})

test("rejects a stray character in the host", () => {
  assert.match(
    urlProblem("wss://api.example.com}", ["wss:", "ws:"], "--broker") ?? "",
    /--broker "wss:\/\/api\.example\.com}" has an invalid host/,
  )
})

test("rejects the wrong scheme and non-URLs", () => {
  assert.match(
    urlProblem("https://api.example.com", ["wss:"], "--broker") ?? "",
    /must use wss:\/\//,
  )
  assert.match(urlProblem("api.example.com", ["wss:"], "--broker") ?? "", /is not a URL/)
  assert.match(
    urlProblem("http://status.example.com/r.json", ["https:"], "--registry") ?? "",
    /https:/,
  )
})
