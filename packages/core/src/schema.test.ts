import assert from "node:assert/strict"
import { test } from "node:test"
import { SchemaError, validateSnapshot } from "./schema.js"

const base = { account: "sub1", source: "github" }
const okItem = {
  key: "pr-1",
  kind: "pr",
  title: "Review it",
  fingerprint: "abc",
  url: "https://github.com/x/y/pull/1",
}

test("valid snapshot normalizes", () => {
  const s = validateSnapshot({ ...base, items: [okItem] }, 100)
  assert.equal(s.account, "sub1")
  assert.equal(s.items.length, 1)
  assert.equal(s.items[0]?.key, "sub1:github:pr-1")
  assert.equal(s.items[0]?.priority, 2)
})

test("bad account id rejected", () => {
  assert.throws(
    () => validateSnapshot({ account: "Sub_1", source: "github", items: [] }, 1),
    SchemaError,
  )
})

test("missing items without failed rejected", () => {
  assert.throws(() => validateSnapshot({ ...base }, 1), SchemaError)
})

test("failed snapshot keeps no items", () => {
  const s = validateSnapshot({ ...base, failed: true, note: "down" }, 1)
  assert.equal(s.failed, true)
  assert.equal(s.items.length, 0)
})

test("unknown kind rejected", () => {
  assert.throws(
    () => validateSnapshot({ ...base, items: [{ ...okItem, kind: "widget" }] }, 1),
    SchemaError,
  )
})

test("duplicate keys rejected", () => {
  assert.throws(() => validateSnapshot({ ...base, items: [okItem, okItem] }, 1), SchemaError)
})

test("non-allowlisted url dropped to null", () => {
  const s = validateSnapshot({ ...base, items: [{ ...okItem, url: "https://evil.example/x" }] }, 1)
  assert.equal(s.items[0]?.url, null)
})

test("two instances of same vendor coexist with distinct keys and meta", () => {
  const s = validateSnapshot(
    {
      ...base,
      source: "jira",
      items: [
        {
          key: "alpha:a-1",
          kind: "ticket",
          title: "t",
          fingerprint: "1",
          meta: { instance: "alpha" },
        },
        {
          key: "beta:a-1",
          kind: "ticket",
          title: "t",
          fingerprint: "1",
          meta: { instance: "beta" },
        },
      ],
    },
    1,
  )
  assert.equal(s.items.length, 2)
  assert.equal(s.items[0]?.meta.instance, "alpha")
  assert.equal(s.items[1]?.meta.instance, "beta")
})

test("an item carries a long body up to its limit", () => {
  const s = validateSnapshot({ ...base, items: [{ ...okItem, body: "b".repeat(20_000) }] }, 1)
  assert.equal(s.items[0]?.body?.length, 16_000)
  const plain = validateSnapshot({ ...base, items: [okItem] }, 1)
  assert.equal(plain.items[0]?.body, null)
})
