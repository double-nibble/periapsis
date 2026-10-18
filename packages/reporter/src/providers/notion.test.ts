import assert from "node:assert/strict"
import { test } from "node:test"
import { notion, notionItem, pageId, pageTitle } from "./notion.js"

const page = {
  id: "aaaabbbbccccddddeeeeffff00001111",
  url: "https://www.notion.so/RFC-Retention-aaaabbbbccccddddeeeeffff00001111",
  last_edited_time: "2026-10-17T10:00:00.000Z",
  properties: { Name: { type: "title", title: [{ plain_text: "RFC: Retention" }] } },
}
const comment = (id: string, discussion: string, by: string, at: string, words = "a point") => ({
  id,
  discussion_id: discussion,
  created_time: at,
  created_by: { id: by },
  rich_text: [{ plain_text: words }],
})

test("pageId takes a URL or a dashed id", () => {
  assert.equal(pageId(page.url), page.id)
  assert.equal(pageId("aaaabbbb-cccc-dddd-eeee-ffff00001111"), page.id)
  assert.throws(() => pageId("nope"))
})

test("notionItem counts discussions awaiting you and unchecked to-dos", () => {
  const it = notionItem(
    page,
    [
      comment("1", "d1", "bob", "2026-10-16T10:00:00Z", "Why 30 days?"),
      comment("2", "d1", "me", "2026-10-16T11:00:00Z"),
      comment("3", "d2", "eve", "2026-10-16T12:00:00Z", "Who owns deletion?"),
    ],
    [
      {
        id: "b1",
        type: "to_do",
        to_do: { checked: false, rich_text: [{ plain_text: "Pick a default" }] },
      },
      { id: "b2", type: "to_do", to_do: { checked: true, rich_text: [] } },
      { id: "b3", type: "paragraph" },
    ],
    "me",
    "notion",
  )
  assert.equal(pageTitle(page), "RFC: Retention")
  assert.equal(it.meta?.threads, "2")
  assert.equal(it.meta?.toAnswer, "1")
  assert.equal(it.meta?.todos, "1")
  assert.equal(it.meta?.action, "Answer 1 comment thread")
  assert.match(it.body ?? "", /- \[ \] Pick a default/)
})

test("notion searches pages by title and maps your user by email", async () => {
  const orig = globalThis.fetch
  const calls: string[] = []
  const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push(
      `${init.method ?? "GET"} ${url} ${(init.headers as Record<string, string>)["notion-version"]}`,
    )
    if (url.endsWith("/search"))
      return reply({ results: [page, { ...page, id: "x", properties: {} }] })
    if (url.includes("/users"))
      return reply({ results: [{ id: "me", type: "person", person: { email: "me@example.com" } }] })
    if (url.includes("/comments"))
      return reply({ results: [comment("1", "d1", "bob", "2026-10-16T10:00:00Z")] })
    return reply({ results: [] })
  }) as unknown as typeof fetch
  try {
    const r = await notion.read({
      provider: "notion",
      instance: "notion",
      params: { token: "secret_x", email: "me@example.com" },
    })
    assert.equal(r.items.length, 1)
    assert.equal(r.items[0]?.meta?.action, "Answer 1 comment thread")
    assert.ok(calls.some((c) => c.startsWith("POST https://api.notion.com/v1/search 2026-03-11")))
  } finally {
    globalThis.fetch = orig
  }
})
