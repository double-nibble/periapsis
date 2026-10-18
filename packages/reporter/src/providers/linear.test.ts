import assert from "node:assert/strict"
import { test } from "node:test"
import {
  type LinearProject,
  linear,
  linearIssueItem,
  linearProjectItem,
  linearProjects,
} from "./linear.js"

const NOW = new Date(2026, 9, 18, 12)
const issue = (over = {}) => ({
  identifier: "ENG-1",
  title: "Rotate tokens",
  url: "https://linear.app/acme/issue/ENG-1",
  updatedAt: "2026-10-17T10:00:00Z",
  state: { name: "Todo", type: "unstarted" },
  project: { name: "Security" },
  ...over,
})
const project = (over: Partial<LinearProject> = {}): LinearProject => ({
  id: "p1",
  name: "Q3 launch",
  url: "https://linear.app/acme/project/q3",
  progress: 0.62,
  targetDate: "2026-10-31",
  health: "atRisk",
  updatedAt: "2026-10-17T10:00:00Z",
  status: { name: "In Progress", type: "started" },
  lead: { name: "Kurt", isMe: true },
  lastUpdate: {
    createdAt: "2026-10-01T10:00:00Z",
    health: "atRisk",
    url: "https://linear.app/u",
    body: "Behind on checkout.",
  },
  issues: {
    nodes: [{ assignee: { isMe: true } }, { assignee: { isMe: false } }, { assignee: null }],
  },
  ...over,
})

test("linearIssueItem ranks started and due work first and backlog last", () => {
  assert.equal(linearIssueItem(issue(), "lin", NOW).priority, 2)
  assert.equal(
    linearIssueItem(issue({ state: { name: "In Progress", type: "started" } }), "lin", NOW)
      .priority,
    1,
  )
  assert.equal(linearIssueItem(issue({ dueDate: "2026-10-17" }), "lin", NOW).priority, 1)
  assert.equal(
    linearIssueItem(issue({ state: { name: "Backlog", type: "backlog" } }), "lin", NOW).priority,
    3,
  )
  assert.equal(
    linearIssueItem(issue({ dueDate: "2026-10-20" }), "lin", NOW).detail,
    "ENG-1 · Todo · due 2026-10-20",
  )
})

test("linearProjectItem asks a lead for an overdue update and counts your issues", () => {
  const it = linearProjectItem(project(), "lin", NOW.getTime())
  assert.equal(it.meta?.action, "Post a project update")
  assert.equal(it.meta?.health, "atRisk")
  assert.equal(it.meta?.progress, "0.62")
  assert.equal(it.meta?.issues, "3")
  assert.equal(it.meta?.forYou, "1")
  assert.equal(it.body, "Behind on checkout.")
  const fresh = linearProjectItem(
    project({ lead: { name: "Bob", isMe: false }, health: "onTrack", lastUpdate: null }),
    "lin",
    NOW.getTime(),
  )
  assert.equal(fresh.meta?.action, undefined)
  assert.equal(fresh.meta?.health, "onTrack")
  assert.equal(fresh.priority, 2)
})

test("linear sends the API key as is and reports GraphQL errors", async () => {
  const orig = globalThis.fetch
  let auth = ""
  let body = ""
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    auth = String((init.headers as Record<string, string>).authorization)
    body = String(init.body)
    return {
      ok: true,
      status: 200,
      json: async () =>
        body.includes("assignedIssues")
          ? { data: { viewer: { assignedIssues: { nodes: [issue()] } } } }
          : { errors: [{ message: "Argument Validation Error" }] },
    }
  }) as unknown as typeof fetch
  try {
    const r = await linear.read({
      provider: "linear",
      instance: "lin",
      params: { apiKey: "lin_api_x" },
    })
    assert.equal(auth, "lin_api_x")
    assert.equal(r.items[0]?.key, "ENG-1")
    await assert.rejects(
      linearProjects.read({
        provider: "linear-projects",
        instance: "lin",
        params: { apiKey: "k" },
      }),
      /Linear: Argument Validation Error/,
    )
  } finally {
    globalThis.fetch = orig
  }
})
