import assert from "node:assert/strict"
import { test } from "node:test"
import { issueItem, jira, siteOrigin } from "./jira.js"

const issue = (key: string, fields: object = {}) => ({
  key,
  fields: {
    summary: `Do ${key}`,
    status: { name: "To Do", statusCategory: { key: "new" } },
    updated: "2026-10-18T10:00:00.000+0000",
    project: { name: "Platform" },
    ...fields,
  },
})

test("siteOrigin accepts a host or a URL", () => {
  assert.equal(siteOrigin("acme.atlassian.net"), "https://acme.atlassian.net")
  assert.equal(siteOrigin("https://acme.atlassian.net/jira/"), "https://acme.atlassian.net")
  assert.throws(() => siteOrigin(""), /needs site/)
})

test("issueItem ranks in progress and due work first and backlog last", () => {
  const now = new Date(2026, 9, 18, 12)
  const o = "https://acme.atlassian.net"
  assert.equal(issueItem(issue("A-1"), o, "j", now).priority, 2)
  const doing = issue("A-2", {
    status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
  })
  assert.equal(issueItem(doing, o, "j", now).priority, 1)
  assert.equal(issueItem(issue("A-3", { duedate: "2026-10-18" }), o, "j", now).priority, 1)
  const backlog = issue("A-4", { status: { name: "Backlog", statusCategory: { key: "new" } } })
  assert.equal(issueItem(backlog, o, "j", now).priority, 3)
  const it = issueItem(issue("A-3", { duedate: "2026-10-18" }), o, "j", now)
  assert.equal(it.url, "https://acme.atlassian.net/browse/A-3")
  assert.equal(it.detail, "A-3 · To Do · due 2026-10-18")
  assert.equal(it.group, "Platform")
})

test("jira pages through search results with basic auth", async () => {
  const orig = globalThis.fetch
  const urls: string[] = []
  let auth = ""
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    urls.push(url)
    auth = String((init.headers as Record<string, string>).authorization)
    const page =
      urls.length === 1
        ? { issues: [issue("A-1")], nextPageToken: "p2", isLast: false }
        : { issues: [issue("A-2")], isLast: true }
    return { ok: true, status: 200, json: async () => page }
  }) as unknown as typeof fetch
  try {
    const r = await jira.read({
      provider: "jira",
      instance: "acme",
      params: { site: "acme.atlassian.net", email: "me@example.com", token: "t" },
    })
    assert.deepEqual(
      r.items.map((i) => i.key),
      ["A-1", "A-2"],
    )
    assert.match(
      urls[0] ?? "",
      /^https:\/\/acme\.atlassian\.net\/rest\/api\/3\/search\/jql\?jql=assignee/,
    )
    assert.match(urls[1] ?? "", /nextPageToken=p2/)
    assert.equal(auth, `Basic ${Buffer.from("me@example.com:t").toString("base64")}`)
  } finally {
    globalThis.fetch = orig
  }
})
