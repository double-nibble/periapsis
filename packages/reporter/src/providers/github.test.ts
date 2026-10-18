import assert from "node:assert/strict"
import { test } from "node:test"
import { node } from "./github-pr.fixture.js"
import { credentials, github, githubProvider } from "./github.js"

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
  return node(over)
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
    assert.equal(item?.key, "https://github.com/acme/api/pull/7")
    assert.equal(item?.meta?.instance, "acme")
    assert.equal(item?.group, "acme/api")
  } finally {
    globalThis.fetch = origFetch
  }
})

test("failing checks raise priority to 1", async () => {
  mockGraphql([
    pr({
      commits: {
        nodes: [
          {
            commit: {
              statusCheckRollup: {
                contexts: {
                  nodes: [
                    {
                      __typename: "CheckRun",
                      name: "ci",
                      status: "COMPLETED",
                      conclusion: "FAILURE",
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    }),
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

test("without a token or a gh login, reading explains how to log in", async () => {
  const none = githubProvider(async () => {
    throw new Error("no GitHub token: run `gh auth login` on this machine, or set params.token")
  })
  await assert.rejects(() => none.read({ provider: "github", instance: "x" }), /gh auth login/)
})

test("credentials default to the gh token and that token's user", async () => {
  const sent: string[] = []
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(String((init.headers as Record<string, string>).authorization))
    return { ok: true, status: 200, json: async () => ({ data: { viewer: { login: "kurt" } } }) }
  }) as unknown as typeof fetch
  try {
    assert.deepEqual(await credentials({}, async () => "gho_x"), { token: "gho_x", login: "kurt" })
    assert.deepEqual(sent, ["bearer gho_x"])
    assert.deepEqual(await credentials({ token: "t", login: "me" }, async () => "unused"), {
      token: "t",
      login: "me",
    })
  } finally {
    globalThis.fetch = origFetch
  }
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
