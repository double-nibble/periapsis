import assert from "node:assert/strict"
import { test } from "node:test"
import { collectSource } from "./collect.js"
import type { InstanceConfig, Provider } from "./provider.js"

const jira: Provider = {
  source: "jira",
  async read(cfg: InstanceConfig) {
    if ((cfg.params.fail as boolean) === true) throw new Error("auth failed")
    return {
      items: [
        {
          key: "T-1",
          kind: "ticket",
          title: `from ${cfg.instance}`,
          fingerprint: "f",
          meta: { domain: String(cfg.params.domain ?? "") },
        },
      ],
    }
  },
}

test("two instances produce one combined set with distinct keys and meta", async () => {
  const snap = await collectSource("sub2", jira, [
    { provider: "jira", instance: "team-a", params: { domain: "a.net" } },
    { provider: "jira", instance: "team-b", params: { domain: "b.net" } },
  ])
  assert.equal(snap.items.length, 2)
  assert.equal(snap.items[0]?.key, "sub2:jira:team-a/T-1")
  assert.equal(snap.items[1]?.key, "sub2:jira:team-b/T-1")
  assert.equal(snap.items[0]?.meta.instance, "team-a")
  assert.equal(snap.items[1]?.meta.instance, "team-b")
  assert.equal(snap.failed, false)
})

test("a failing instance does not sink the others", async () => {
  const snap = await collectSource("sub2", jira, [
    { provider: "jira", instance: "ok", params: {} },
    { provider: "jira", instance: "broken", params: { fail: true } },
  ])
  assert.equal(snap.items.length, 1)
  assert.equal(snap.items[0]?.meta.instance, "ok")
  assert.equal(snap.failed, false)
  assert.match(snap.note ?? "", /broken: auth failed/)
})

test("all instances failing marks the source failed", async () => {
  const snap = await collectSource("sub2", jira, [
    { provider: "jira", instance: "a", params: { fail: true } },
    { provider: "jira", instance: "b", params: { fail: true } },
  ])
  assert.equal(snap.failed, true)
  assert.equal(snap.items.length, 0)
})

test("default priority is 2", async () => {
  const snap = await collectSource("sub1", jira, [{ provider: "jira", instance: "x", params: {} }])
  assert.equal(snap.items[0]?.priority, 2)
})
