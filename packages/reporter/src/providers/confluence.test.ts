import assert from "node:assert/strict"
import { test } from "node:test"
import { confluence, pageItem } from "./confluence.js"

const page = (over = {}) => ({
  id: "1",
  title: "RFC: Retention",
  url: "https://acme.atlassian.net/wiki/spaces/ENG/pages/1",
  edited: "2026-10-17T10:00:00Z",
  mentioned: false,
  comments: [],
  ...over,
})

test("pageItem asks you to answer open comments from others", () => {
  const it = pageItem(
    page({
      comments: [
        { id: "a", resolutionStatus: "open", version: { authorId: "bob" } },
        { id: "b", resolutionStatus: "open", version: { authorId: "me" } },
        { id: "c", resolutionStatus: "resolved", version: { authorId: "eve" } },
      ],
    }),
    "me",
    "wiki",
  )
  assert.equal(it.priority, 1)
  assert.equal(it.meta?.action, "Answer 1 comment thread")
  assert.equal(it.meta?.threads, "2")
  assert.equal(it.meta?.toAnswer, "1")
})

test("pageItem flags a mention, and leaves a quiet page without an action", () => {
  assert.equal(pageItem(page({ mentioned: true }), "me", "wiki").meta?.action, "Read the mention")
  const quiet = pageItem(page(), "me", "wiki")
  assert.equal(quiet.meta?.action, undefined)
  assert.equal(quiet.priority, 3)
})

test("confluence searches mentions and your pages, then reads their comments", async () => {
  const orig = globalThis.fetch
  const urls: string[] = []
  const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
  globalThis.fetch = (async (url: string) => {
    urls.push(decodeURIComponent(url))
    if (url.endsWith("/user/current")) return reply({ accountId: "me" })
    if (url.includes("/content/search")) {
      const mention = decodeURIComponent(url).includes("mention = currentUser()")
      return reply({
        results: [
          {
            id: mention ? "2" : "1",
            title: mention ? "Launch notes" : "RFC: Retention",
            _links: { webui: `/spaces/ENG/pages/${mention ? 2 : 1}` },
            version: { when: "2026-10-17T10:00:00Z" },
          },
        ],
        _links: { base: "https://acme.atlassian.net/wiki" },
      })
    }
    if (url.includes("/pages/1/inline-comments"))
      return reply({
        results: [{ id: "a", resolutionStatus: "open", version: { authorId: "bob" } }],
      })
    return reply({ results: [] })
  }) as unknown as typeof fetch
  try {
    const r = await confluence.read({
      provider: "confluence",
      instance: "wiki",
      params: { site: "acme.atlassian.net", email: "me@example.com", token: "t" },
    })
    const by = Object.fromEntries(r.items.map((i) => [i.key, i]))
    assert.equal(by["1"]?.meta?.action, "Answer 1 comment thread")
    assert.equal(by["2"]?.meta?.action, "Read the mention")
    assert.equal(by["2"]?.url, "https://acme.atlassian.net/wiki/spaces/ENG/pages/2")
    assert.ok(urls.some((u) => u.includes('contributor = currentUser() AND lastmodified >= "')))
  } finally {
    globalThis.fetch = orig
  }
})
