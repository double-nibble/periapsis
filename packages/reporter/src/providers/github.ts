import type { InstanceConfig, Provider, ProviderItem, ProviderResult } from "../provider.js"

const ENDPOINT = "https://api.github.com/graphql"

const QUERY = `
query($q: String!, $first: Int!) {
  search(query: $q, type: ISSUE, first: $first) {
    nodes { ... on PullRequest {
      number title url isDraft createdAt
      repository { nameWithOwner }
      reviewDecision mergeStateStatus
      commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } }
    } }
  }
}`

interface PrNode {
  number: number
  title: string
  url: string
  isDraft: boolean
  repository: { nameWithOwner: string }
  reviewDecision: string | null
  mergeStateStatus: string | null
  commits: { nodes: { commit: { oid: string; statusCheckRollup: { state: string } | null } }[] }
}

function status(pr: PrNode, mine: boolean): { title: string; priority: 1 | 2 | 3 } {
  const rollup = pr.commits.nodes[0]?.commit.statusCheckRollup?.state
  if (!mine) return { title: `Review ${pr.repository.nameWithOwner}#${pr.number}`, priority: 1 }
  if (pr.isDraft) return { title: "Finish the draft and mark it ready", priority: 2 }
  if (rollup === "FAILURE" || rollup === "ERROR")
    return { title: "Fix failing checks", priority: 1 }
  if (pr.reviewDecision === "CHANGES_REQUESTED")
    return { title: "Address requested changes", priority: 1 }
  if (pr.reviewDecision === "APPROVED" && pr.mergeStateStatus === "CLEAN")
    return { title: "Merge it", priority: 1 }
  if (pr.reviewDecision === "APPROVED" && pr.mergeStateStatus === "BEHIND")
    return { title: "Update the branch, then merge", priority: 2 }
  return { title: "In review", priority: 3 }
}

async function graphql(
  token: string,
  q: string,
  variables: object,
): Promise<{ search: { nodes: PrNode[] } }> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { authorization: `bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: q, variables }),
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = (await res.json()) as {
    data?: { search: { nodes: PrNode[] } }
    errors?: { message: string }[]
  }
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "))
  if (!json.data) throw new Error("GitHub API returned no data")
  return json.data
}

function toItem(pr: PrNode, instance: string, mine: boolean): ProviderItem {
  const s = status(pr, mine)
  const ref = `${pr.repository.nameWithOwner}#${pr.number}`
  return {
    key: pr.url,
    kind: "pr",
    priority: s.priority,
    title: s.title,
    detail: `${ref} · ${pr.title}`,
    url: pr.url,
    group: pr.repository.nameWithOwner,
    fingerprint: `${pr.commits.nodes[0]?.commit.oid ?? ""}:${pr.reviewDecision}:${pr.mergeStateStatus}`,
    meta: { instance, repo: pr.repository.nameWithOwner },
  }
}

// Params: { token: string, login: string }. Reads PRs authored by and awaiting
// review from the login, normalized to pr items.
export const github: Provider = {
  source: "github",
  async read(config: InstanceConfig): Promise<ProviderResult> {
    const params = config.params ?? {}
    const token = String(params.token ?? "")
    const login = String(params.login ?? "")
    if (!token || !login) throw new Error("github instance needs token and login")
    const [mine, review] = await Promise.all([
      graphql(token, QUERY, { q: `is:pr is:open archived:false author:${login}`, first: 50 }),
      graphql(token, QUERY, {
        q: `is:pr is:open archived:false user-review-requested:${login}`,
        first: 30,
      }),
    ])
    const items = [
      ...mine.search.nodes.map((pr) => toItem(pr, config.instance, true)),
      ...review.search.nodes.map((pr) => toItem(pr, config.instance, false)),
    ]
    return { items }
  },
}
