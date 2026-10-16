import assert from "node:assert/strict"
import { test } from "node:test"
import type { AccountConfig, InstanceConfig, Provider } from "./provider.js"

test("an account config holds a list of provider instances", () => {
  const cfg: AccountConfig = {
    account: "sub2",
    instances: [
      { provider: "jira", instance: "team-a", params: { domain: "a.atlassian.net" } },
      { provider: "jira", instance: "team-b", params: { domain: "b.atlassian.net" } },
      { provider: "github", instance: "acme", params: { org: "acme" } },
    ],
  }
  const jira = cfg.instances.filter((i) => i.provider === "jira")
  assert.equal(jira.length, 2)
  assert.notEqual(jira[0]?.instance, jira[1]?.instance)
})

test("a provider declares its abstract source and reads an instance", async () => {
  const fake: Provider = {
    source: "ticket-system",
    async read(config: InstanceConfig) {
      return {
        items: [{ key: `${config.instance}-1`, kind: "ticket", title: "t", fingerprint: "f" }],
      }
    },
  }
  assert.equal(fake.source, "ticket-system")
  const r = await fake.read({ provider: "x", instance: "alpha", params: {} })
  assert.equal(r.items[0]?.key, "alpha-1")
})
