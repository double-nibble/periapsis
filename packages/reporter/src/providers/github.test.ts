import assert from "node:assert/strict"
import { test } from "node:test"
import { github } from "./github.js"

const origFetch = globalThis.fetch

function mockGraphql(nodes: unknown[]) {
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ data: { search: { nodes } } }),
    }) as unknown as Response) as typeof fetch
}

function pr(over: object) {
  return {
    number: 1,
    title: "A PR",
    url: "https://github.com/acme/api/pull/1",
    isDraft: false,
    repository: { nameWithOwner: "acme/api" },
    reviewDecision: null,
    mergeStateStatus: null,
    commits: { nodes: [{ commit: { oid: "abc", statusCheckRollup: { state: "SUCCESS" } } }] },
    ...over,
  }
}

test("normalizes an authored PR to a pr item with instance meta", async () => {
  mockGraphql([pr({})])
  try {
    const r = await github.read({
      provider: "github",
      instance: "acme",
      params: { token: "t", login: "me" },
    })
    const item = r.items[0]
    assert.equal(item?.kind, "pr")
    assert.equal(item?.key, "https://github.com/acme/api/pull/1")
    assert.equal(item?.meta?.instance, "acme")
    assert.equal(item?.group, "acme/api")
  } finally {
    globalThis.fetch = origFetch
  }
})

test("failing checks raise priority to 1", async () => {
  mockGraphql([
    pr({ commits: { nodes: [{ commit: { oid: "x", statusCheckRollup: { state: "FAILURE" } } }] } }),
  ])
  try {
    const r = await github.read({
      provider: "github",
      instance: "acme",
      params: { token: "t", login: "me" },
    })
    assert.equal(r.items[0]?.priority, 1)
    assert.match(r.items[0]?.title ?? "", /failing checks/)
  } finally {
    globalThis.fetch = origFetch
  }
})

test("missing token or login throws", async () => {
  await assert.rejects(() => github.read({ provider: "github", instance: "x", params: {} }))
})

// Integration: runs only with GH_TEST_TOKEN + GH_TEST_LOGIN set.
test("reads real PRs", { skip: !process.env.GH_TEST_TOKEN }, async () => {
  const r = await github.read({
    provider: "github",
    instance: "real",
    params: { token: process.env.GH_TEST_TOKEN, login: process.env.GH_TEST_LOGIN },
  })
  assert.ok(Array.isArray(r.items))
})
