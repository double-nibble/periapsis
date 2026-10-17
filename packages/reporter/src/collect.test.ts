import assert from "node:assert/strict"
import { test } from "node:test"
import { toItem } from "./collect.js"

test("toItem namespaces the key by account, source and instance", () => {
  const item = toItem(
    { key: "T-1", kind: "ticket", title: "t", fingerprint: "f", meta: { domain: "a.net" } },
    "sub2",
    "jira",
    "team-a",
  )
  assert.equal(item.key, "sub2:jira:team-a/T-1")
  assert.equal(item.meta.instance, "team-a")
  assert.equal(item.meta.domain, "a.net")
  assert.equal(item.priority, 2)
})
