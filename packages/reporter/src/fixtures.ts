export interface StubSnapshot {
  account: string
  source: string
  items: object[]
}

export const FIXTURES: StubSnapshot[] = [
  {
    account: "sub1",
    source: "github",
    items: [
      {
        key: "pr-14",
        kind: "pr",
        priority: 1,
        title: "Review the auth refactor",
        detail: "api#14 awaiting your review",
        fingerprint: "a1",
        meta: { instance: "acme-gh", repo: "acme/api" },
      },
      {
        key: "pr-22",
        kind: "pr",
        priority: 2,
        title: "Merge the logging cleanup",
        detail: "api#22 approved, behind base",
        fingerprint: "a2",
        meta: { instance: "acme-gh", repo: "acme/api" },
      },
    ],
  },
  {
    account: "sub1",
    source: "linear",
    items: [
      {
        key: "ENG-301",
        kind: "ticket",
        priority: 1,
        title: "Decide on the cache TTL",
        detail: "blocking the rollout",
        fingerprint: "b1",
        meta: { instance: "acme-linear" },
      },
    ],
  },
  {
    account: "sub1",
    source: "gcal",
    items: [
      {
        key: "ev-standup",
        kind: "calendar",
        title: "Team standup",
        fingerprint: "c1",
        meta: { at: "2026-10-16T09:00" },
      },
      {
        key: "ev-1on1",
        kind: "calendar",
        title: "1:1 with Dana",
        fingerprint: "c2",
        meta: { at: "2026-10-16T13:30" },
      },
    ],
  },
  {
    account: "sub2",
    source: "bitbucket",
    items: [
      {
        key: "pr-7",
        kind: "pr",
        priority: 2,
        title: "Review the pipeline fix",
        detail: "infra/deploy#7",
        fingerprint: "d1",
        meta: { instance: "globex-bb", repo: "globex/infra" },
      },
    ],
  },
  {
    account: "sub2",
    source: "jira",
    items: [
      {
        key: "OPS-88",
        kind: "ticket",
        priority: 1,
        title: "Triage the prod alert",
        detail: "pager fired at 03:10",
        fingerprint: "e1",
        meta: { instance: "globex-jira" },
      },
      {
        key: "OPS-91",
        kind: "ticket",
        priority: 3,
        title: "Close out the postmortem",
        fingerprint: "e2",
        meta: { instance: "globex-jira" },
      },
    ],
  },
  {
    account: "sub2",
    source: "gcal",
    items: [
      {
        key: "ev-review",
        kind: "calendar",
        title: "Architecture review",
        fingerprint: "f1",
        meta: { at: "2026-10-16T11:00" },
      },
    ],
  },
]
