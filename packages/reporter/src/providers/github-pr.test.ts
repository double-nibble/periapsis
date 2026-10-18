import assert from "node:assert/strict"
import { test } from "node:test"
import { node } from "./github-pr.fixture.js"
import { type PrNode, normalizePr, prActions, prItem, prStatus } from "./github-pr.js"

const NOW = Date.parse("2026-10-18T12:00:00Z")

const titles = (n: PrNode, role: "author" | "reviewer" = "author") =>
  prActions(normalizePr(n, "kurt"), role, NOW).map((a) => a.title)

test("a PR in review with nothing to do has no actions", () => {
  assert.deepEqual(titles(node()), [])
  assert.equal(prStatus(normalizePr(node(), "kurt")).label, "In review")
})

test("failing checks, requested changes and unanswered threads are each an action", () => {
  const n = node({
    reviewDecision: "CHANGES_REQUESTED",
    latestReviews: {
      nodes: [
        {
          state: "CHANGES_REQUESTED",
          submittedAt: "2026-10-17T00:00:00Z",
          author: { login: "dana" },
        },
      ],
    },
    reviewThreads: {
      nodes: [
        { isResolved: false, comments: { nodes: [{ id: "c1", author: { login: "dana" } }] } },
        { isResolved: false, comments: { nodes: [{ id: "c2", author: { login: "kurt" } }] } },
        { isResolved: true, comments: { nodes: [{ id: "c3", author: { login: "riain" } }] } },
      ],
    },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: {
                nodes: [
                  {
                    __typename: "CheckRun",
                    name: "lint",
                    status: "COMPLETED",
                    conclusion: "FAILURE",
                  },
                  { __typename: "StatusContext", context: "deploy", state: "ERROR" },
                ],
              },
            },
          },
        },
      ],
    },
  })
  assert.deepEqual(titles(n), [
    "Fix failing checks: lint, deploy",
    "Address requested changes",
    "Reply to dana",
  ])
})

test("an approved PR is ready to merge, unless it is stacked or behind", () => {
  const approved = { reviewDecision: "APPROVED" }
  assert.deepEqual(titles(node(approved)), ["Merge it"])
  assert.deepEqual(titles(node({ ...approved, mergeStateStatus: "BEHIND" })), [
    "Update the branch, then merge",
  ])
  assert.deepEqual(titles(node({ ...approved, baseRefName: "feature/base" })), [])
})

test("a PR with no reviewers asks for them; a stale one asks to chase them", () => {
  assert.deepEqual(titles(node({ reviewRequests: { nodes: [] } })), ["Request reviewers"])
  assert.deepEqual(titles(node({ createdAt: "2026-10-01T12:00:00Z" })), [
    "Chase reviewers (open 17 days)",
  ])
})

test("drafts and review requests have one action each", () => {
  assert.deepEqual(titles(node({ isDraft: true })), ["Finish the draft and mark it ready"])
  assert.deepEqual(titles(node({ author: { login: "dana" } }), "reviewer"), ["Review for dana"])
})

test("prItem titles a PR with its first action and carries its details", () => {
  const it = prItem(normalizePr(node({ reviewDecision: "APPROVED" }), "kurt"), "author", "gh", NOW)
  assert.equal(it.title, "Merge it")
  assert.equal(it.priority, 1)
  assert.equal(it.detail, "acme/api#7 · Add the thing")
  assert.equal(it.meta?.action, "Merge it")
  assert.equal(it.meta?.size, "+50/-3")
  assert.equal(it.meta?.checks, "pass")
  const quiet = prItem(normalizePr(node(), "kurt"), "author", "gh", NOW)
  assert.equal(quiet.title, "In review")
  assert.equal(quiet.meta?.action, undefined)
  assert.equal(quiet.priority, 3)
})
