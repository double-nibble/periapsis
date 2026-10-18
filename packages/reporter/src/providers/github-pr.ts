import type { ProviderItem } from "../provider.js"

const DAY = 86_400_000
// An authored PR in review this long with no other action gets a nudge to chase reviewers.
export const STALE_REVIEW_DAYS = 7

const FAILED = new Set(
  "FAILURE ERROR TIMED_OUT CANCELLED STARTUP_FAILURE ACTION_REQUIRED".split(" "),
)
const PENDING = new Set("PENDING QUEUED IN_PROGRESS WAITING REQUESTED EXPECTED".split(" "))

interface Actor {
  __typename?: string
  login?: string
}

// The GraphQL shape the provider queries for each pull request.
export interface PrNode {
  number: number
  title: string
  url: string
  isDraft: boolean
  createdAt: string
  additions: number
  deletions: number
  baseRefName: string
  headRefOid: string
  repository: { nameWithOwner: string; defaultBranchRef: { name: string } | null }
  author: Actor | null
  reviewDecision: string | null
  mergeStateStatus: string | null
  reviewRequests: { nodes: { requestedReviewer: { login?: string; slug?: string } | null }[] }
  latestReviews: { nodes: { state: string; submittedAt: string; author: Actor | null }[] }
  reviewThreads: {
    nodes: { isResolved: boolean; comments: { nodes: { id: string; author: Actor | null }[] } }[]
  }
  commits: {
    nodes: {
      commit: {
        statusCheckRollup: {
          contexts: {
            nodes: {
              __typename: string
              name?: string
              status?: string
              conclusion?: string | null
              context?: string
              state?: string
            }[]
          }
        } | null
      }
    }[]
  }
}

export interface Pr {
  repo: string
  number: number
  title: string
  url: string
  author: string | null
  isDraft: boolean
  createdAt: string
  additions: number
  deletions: number
  stackedOn: string | null
  headOid: string
  reviewDecision: string | null
  mergeState: string | null
  reviewers: string[]
  approvedBy: string[]
  changesAt: string | null
  failed: string[]
  pending: number
  checks: number
  openThreads: number
  awaitingReply: { id: string; login: string }[]
}

function isBot(actor: Actor | null): boolean {
  return !actor || actor.__typename === "Bot" || /\[bot\]$/.test(actor.login ?? "")
}

export function normalizePr(node: PrNode, viewer: string): Pr {
  const contexts = node.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []
  const checks = contexts.map((c) =>
    c.__typename === "CheckRun"
      ? {
          name: c.name ?? "",
          state: c.status === "COMPLETED" ? (c.conclusion ?? "") : (c.status ?? ""),
        }
      : { name: c.context ?? "", state: c.state ?? "" },
  )
  const reviews = node.latestReviews.nodes.filter((r) => !isBot(r.author))
  const open = node.reviewThreads.nodes.filter((t) => !t.isResolved)
  const base = node.baseRefName
  return {
    repo: node.repository.nameWithOwner,
    number: node.number,
    title: node.title,
    url: node.url,
    author: node.author?.login ?? null,
    isDraft: node.isDraft,
    createdAt: node.createdAt,
    additions: node.additions,
    deletions: node.deletions,
    stackedOn: base === (node.repository.defaultBranchRef?.name ?? "main") ? null : base,
    headOid: node.headRefOid,
    reviewDecision: node.reviewDecision,
    mergeState: node.mergeStateStatus,
    reviewers: node.reviewRequests.nodes
      .map((r) => r.requestedReviewer?.login ?? r.requestedReviewer?.slug ?? "")
      .filter(Boolean),
    approvedBy: reviews.filter((r) => r.state === "APPROVED").map((r) => r.author?.login ?? ""),
    changesAt:
      reviews
        .filter((r) => r.state === "CHANGES_REQUESTED")
        .map((r) => r.submittedAt)
        .sort()
        .at(-1) ?? null,
    failed: checks.filter((c) => FAILED.has(c.state)).map((c) => c.name),
    pending: checks.filter((c) => PENDING.has(c.state)).length,
    checks: checks.length,
    openThreads: open.length,
    awaitingReply: open
      .map((t) => t.comments.nodes[0])
      .filter((c): c is { id: string; author: Actor } => !!c && !isBot(c.author))
      .filter((c) => c.author.login !== viewer)
      .map((c) => ({ id: c.id, login: c.author.login ?? "" })),
  }
}

export function prStatus(pr: Pr): { code: string; label: string } {
  if (pr.isDraft) return { code: "draft", label: "Draft" }
  if (pr.failed.length) return { code: "ci-failed", label: "CI failing" }
  if (pr.reviewDecision === "CHANGES_REQUESTED")
    return { code: "changes", label: "Changes requested" }
  if (pr.awaitingReply.length) return { code: "reply", label: "Reply needed" }
  if (pr.reviewDecision === "APPROVED") {
    if (pr.stackedOn) return { code: "stacked", label: "Approved, waits on parent" }
    if (pr.mergeState === "BEHIND") return { code: "behind", label: "Approved, behind base" }
    if (pr.mergeState === "DIRTY") return { code: "conflict", label: "Approved, has conflicts" }
    if (pr.pending) return { code: "pending", label: "Approved, checks running" }
    return { code: "ready", label: "Ready to merge" }
  }
  if (!pr.reviewers.length && !pr.approvedBy.length && !pr.changesAt)
    return { code: "no-reviewers", label: "No reviewers" }
  return { code: "in-review", label: pr.stackedOn ? "In review (stacked)" : "In review" }
}

interface Action {
  title: string
  priority: 1 | 2 | 3
  fingerprint: string
}

// What the viewer has to do about a PR, most urgent first.
export function prActions(pr: Pr, role: "author" | "reviewer", now: number): Action[] {
  if (role === "reviewer") {
    return [{ title: `Review for ${pr.author ?? "someone"}`, priority: 1, fingerprint: pr.headOid }]
  }
  if (pr.isDraft)
    return [{ title: "Finish the draft and mark it ready", priority: 2, fingerprint: pr.headOid }]
  const out: Action[] = []
  const add = (title: string, priority: 1 | 2 | 3, fingerprint: string) =>
    out.push({ title, priority, fingerprint })
  if (pr.failed.length)
    add(
      `Fix failing checks: ${pr.failed.slice(0, 3).join(", ")}`,
      1,
      `${pr.headOid}:${[...pr.failed].sort().join(",")}`,
    )
  if (pr.reviewDecision === "CHANGES_REQUESTED")
    add("Address requested changes", 1, pr.changesAt ?? pr.headOid)
  if (pr.awaitingReply.length) {
    const who = [...new Set(pr.awaitingReply.map((c) => c.login))].join(", ")
    add(
      `Reply to ${who}`,
      1,
      pr.awaitingReply
        .map((c) => c.id)
        .sort()
        .join(","),
    )
  }
  const status = prStatus(pr).code
  if (status === "ready") add("Merge it", 1, pr.headOid)
  if (status === "conflict") add("Resolve merge conflicts", 1, pr.headOid)
  if (status === "behind") add("Update the branch, then merge", 2, pr.headOid)
  if (status === "no-reviewers") add("Request reviewers", 2, "none")
  const days = Math.floor((now - Date.parse(pr.createdAt)) / DAY)
  if (status === "in-review" && !pr.stackedOn && days > STALE_REVIEW_DAYS)
    add(`Chase reviewers (open ${days} days)`, 3, [...pr.reviewers].sort().join(","))
  return out.sort((a, b) => a.priority - b.priority)
}

function checksSummary(pr: Pr): string {
  if (pr.failed.length) return `${pr.failed.length} failing`
  if (pr.pending) return "pending"
  return pr.checks ? "pass" : "none"
}

// One item per PR. Its title is the next action, or the PR's status when there
// is nothing to do; meta.action marks the PRs that need the viewer.
export function prItem(
  pr: Pr,
  role: "author" | "reviewer",
  instance: string,
  now: number,
): ProviderItem {
  const actions = prActions(pr, role, now)
  const status = prStatus(pr)
  const ref = `${pr.repo}#${pr.number}`
  const first = actions[0]
  return {
    key: pr.url,
    kind: "pr",
    priority: first?.priority ?? 3,
    title: first?.title ?? status.label,
    detail: `${ref} · ${pr.title}`,
    url: pr.url,
    group: pr.repo,
    fingerprint: actions.length
      ? actions.map((a) => a.fingerprint).join("|")
      : `${status.code}:${pr.headOid}`,
    meta: {
      instance,
      role,
      ...(actions.length ? { action: actions.map((a) => a.title).join(" · ") } : {}),
      status: status.code,
      statusLabel: status.label,
      ref,
      repo: pr.repo,
      prTitle: pr.title,
      author: pr.author ?? "",
      createdAt: pr.createdAt,
      size: `+${pr.additions}/-${pr.deletions}`,
      waitingOn: pr.reviewers.join(", "),
      checks: checksSummary(pr),
      ...(pr.failed.length ? { failing: pr.failed.join(", ") } : {}),
      threads: String(pr.openThreads),
      ...(pr.stackedOn ? { stackedOn: pr.stackedOn } : {}),
    },
  }
}
