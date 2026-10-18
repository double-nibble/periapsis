import type { PrNode } from "./github-pr.js"

// A pull request as the GitHub query returns it, for tests.
export function node(over: Partial<PrNode> = {}): PrNode {
  return {
    number: 7,
    title: "Add the thing",
    url: "https://github.com/acme/api/pull/7",
    isDraft: false,
    createdAt: "2026-10-16T12:00:00Z",
    additions: 50,
    deletions: 3,
    baseRefName: "main",
    headRefOid: "abc",
    repository: { nameWithOwner: "acme/api", defaultBranchRef: { name: "main" } },
    author: { __typename: "User", login: "kurt" },
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    reviewRequests: { nodes: [{ requestedReviewer: { login: "dana" } }] },
    latestReviews: { nodes: [] },
    reviewThreads: { nodes: [] },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: {
                nodes: [
                  {
                    __typename: "CheckRun",
                    name: "build",
                    status: "COMPLETED",
                    conclusion: "SUCCESS",
                  },
                ],
              },
            },
          },
        },
      ],
    },
    ...over,
  }
}
