import assert from "node:assert/strict"
import { test } from "node:test"
import type { InstanceConfig, Provider } from "./provider.js"
import {
  type InstanceState,
  type ReporterConfig,
  collectAll,
  collectDue,
  instanceIntervals,
} from "./runtime.js"

const jira: Provider = {
  source: "jira",
  async read(cfg: InstanceConfig) {
    const params = cfg.params ?? {}
    if (params.fail === true) throw new Error("auth failed")
    return {
      items: [{ key: "T-1", kind: "ticket", title: `from ${cfg.instance}`, fingerprint: "f" }],
    }
  },
}

const hub = { signPublic: "", boxPublic: "" }
const providers = new Map<string, Provider>([["jira", jira]])

function config(instances: InstanceConfig[], extra: Partial<ReporterConfig> = {}): ReporterConfig {
  return { account: { account: "sub2", instances }, signPrivate: "", hub, ...extra }
}

test("direct instances of one source combine with distinct keys", async () => {
  const r = await collectAll(
    providers,
    config([
      { provider: "jira", instance: "team-a", params: { domain: "a" } },
      { provider: "jira", instance: "team-b", params: { domain: "b" } },
    ]),
  )
  const jiraResult = r.get("jira")
  assert.equal(jiraResult?.items.length, 2)
  assert.equal(jiraResult?.failed, false)
})

test("a failing instance does not sink the others", async () => {
  const r = await collectAll(
    providers,
    config([
      { provider: "jira", instance: "ok", params: {} },
      { provider: "jira", instance: "broken", params: { fail: true } },
    ]),
  )
  assert.equal(r.get("jira")?.items.length, 1)
  assert.equal(r.get("jira")?.failed, false)
  assert.match(r.get("jira")?.note ?? "", /broken: auth failed/)
})

test("all instances failing marks the source failed", async () => {
  const r = await collectAll(
    providers,
    config([{ provider: "jira", instance: "a", params: { fail: true } }]),
  )
  assert.equal(r.get("jira")?.failed, true)
})

test("an agent instance is routed through the agent runner", async () => {
  const r = await collectAll(
    new Map(),
    config([{ source: "calendar", instance: "mycal", mode: "agent" }], {
      runAgent: () =>
        Promise.resolve({
          result:
            '```json\n{"items":[{"key":"ev1","title":"Standup","fingerprint":"f1","at":"2026-10-17T09:00:00Z"}]}\n```',
          isError: false,
          costUsd: null,
          turns: null,
        }),
    }),
  )
  assert.equal(r.get("calendar")?.items.length, 1)
  assert.equal(r.get("calendar")?.items[0]?.kind, "calendar")
})

test("each instance runs on its own schedule, and a source's snapshot stays complete", async () => {
  const cfg = config([
    { provider: "jira", instance: "slow", every: "1h" },
    { provider: "jira", instance: "fast", every: "1m" },
  ])
  const state = new Map<string, InstanceState>()
  const intervals = instanceIntervals(cfg)
  const first = await collectDue(providers, cfg, state, intervals, 0)
  assert.equal(first.get("jira")?.items.length, 2)
  // two minutes later only the fast instance is due, but the snapshot keeps both
  const later = await collectDue(providers, cfg, state, intervals, 120_000)
  assert.equal(state.get("slow")?.lastRun, 0)
  assert.equal(state.get("fast")?.lastRun, 120_000)
  assert.deepEqual(
    later
      .get("jira")
      ?.items.map((i) => i.title)
      .sort(),
    ["from fast", "from slow"],
  )
  // nothing is due a moment later, so nothing is published
  assert.equal((await collectDue(providers, cfg, state, intervals, 121_000)).size, 0)
})

test("a failing instance keeps its last good items while another succeeds", async () => {
  const flaky = { provider: "jira", instance: "flaky", every: "1m", params: { fail: false } }
  const cfg = config([flaky, { provider: "jira", instance: "steady", every: "1m" }])
  const state = new Map<string, InstanceState>()
  const intervals = instanceIntervals(cfg)
  await collectDue(providers, cfg, state, intervals, 0)
  flaky.params.fail = true
  const r = await collectDue(providers, cfg, state, intervals, 60_000)
  assert.equal(r.get("jira")?.failed, false)
  assert.deepEqual(
    r
      .get("jira")
      ?.items.map((i) => i.title)
      .sort(),
    ["from flaky", "from steady"],
  )
  assert.match(r.get("jira")?.note ?? "", /flaky: auth failed/)
})
