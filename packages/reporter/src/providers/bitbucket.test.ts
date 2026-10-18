import assert from "node:assert/strict"
import { test } from "node:test"
import { type BbPr, bitbucket, normalizeBb, threads } from "./bitbucket.js"
import { prActions } from "./github-pr.js"

const ME = "{me}"
const user = (uuid: string, nickname: string) => ({ uuid, nickname })

function pr(over: Partial<BbPr> = {}): BbPr {
  return {
    id: 7,
    title: "Add the thing",
    draft: false,
    created_on: "2026-10-16T12:00:00Z",
    author: user(ME, "kurt"),
    source: { branch: { name: "feature" }, commit: { hash: "abc" } },
    destination: { branch: { name: "main" } },
    participants: [{ user: user("{bob}", "bob"), role: "REVIEWER", approved: false, state: null }],
    links: { html: { href: "https://bitbucket.org/acme/api/pull-requests/7" } },
    ...over,
  }
}

test("threads counts unresolved threads and those awaiting your reply", () => {
  const t = threads(
    [
      { id: 1, user: user("{bob}", "bob"), created_on: "2026-10-16T13:00:00Z" },
      { id: 2, user: user(ME, "kurt"), created_on: "2026-10-16T14:00:00Z", parent: { id: 1 } },
      { id: 3, user: user("{eve}", "eve"), created_on: "2026-10-16T15:00:00Z" },
      { id: 4, user: user("{eve}", "eve"), created_on: "2026-10-16T16:00:00Z", resolution: {} },
    ],
    ME,
  )
  assert.equal(t.open, 2)
  assert.deepEqual(
    t.awaiting.map((c) => c.id),
    [3],
  )
})

test("normalizeBb feeds the shared PR actions", () => {
  const now = Date.parse("2026-10-18T12:00:00Z")
  const failing = normalizeBb(
    pr(),
    "acme/api",
    "main",
    [{ state: "FAILED", name: "build" }],
    [],
    ME,
  )
  assert.deepEqual(
    prActions(failing, "author", now).map((a) => a.title),
    ["Fix failing checks: build"],
  )
  const approved = pr({
    participants: [
      { user: user("{bob}", "bob"), role: "REVIEWER", approved: true, state: "approved" },
    ],
  })
  assert.deepEqual(
    prActions(normalizeBb(approved, "acme/api", "main", [], [], ME), "author", now).map(
      (a) => a.title,
    ),
    ["Merge it"],
  )
  const stacked = normalizeBb(
    pr({ destination: { branch: { name: "base" } } }),
    "acme/api",
    "main",
    [],
    [],
    ME,
  )
  assert.equal(stacked.stackedOn, "base")
  assert.equal(stacked.additions, null)
})

test("bitbucket reads each repository's PRs for the current user", async () => {
  const orig = globalThis.fetch
  const seen: string[] = []
  const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push(`${(init.headers as Record<string, string>).authorization} ${url}`)
    if (url.endsWith("/2.0/user")) return reply(user(ME, "kurt"))
    if (url.endsWith("/repositories/acme/api")) return reply({ mainbranch: { name: "main" } })
    if (url.includes("/pullrequests?")) return reply({ values: [{ id: 7 }] })
    if (url.endsWith("/pullrequests/7")) return reply(pr())
    return reply({ values: [] })
  }) as unknown as typeof fetch
  try {
    const r = await bitbucket.read({
      provider: "bitbucket",
      instance: "bb",
      params: { repos: ["acme/api"], token: "t" },
    })
    assert.equal(r.items.length, 1)
    assert.equal(r.items[0]?.title, "In review")
    assert.equal(r.items[0]?.url, "https://bitbucket.org/acme/api/pull-requests/7")
    assert.ok(seen.every((s) => s.startsWith("Bearer t ")))
    assert.ok(seen.some((s) => decodeURIComponent(s).includes('reviewers.uuid="{me}"')))
  } finally {
    globalThis.fetch = orig
  }
})
