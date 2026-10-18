import { execFile } from "node:child_process"
import { promisify } from "node:util"
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

async function graphql<T = { search: { nodes: PrNode[] } }>(
  token: string,
  q: string,
  variables: object,
): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { authorization: `bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: q, variables }),
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = (await res.json()) as {
    data?: T
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

export type TokenSource = () => Promise<string>

// The token of the machine's `gh` login.
export const ghToken: TokenSource = async () => {
  try {
    const { stdout } = await promisify(execFile)("gh", ["auth", "token"])
    return stdout.trim()
  } catch {
    throw new Error("no GitHub token: run `gh auth login` on this machine, or set params.token")
  }
}

// The token and login to read with: params.token and params.login when set,
// otherwise the machine's `gh` login and the token's own user.
export async function credentials(
  params: Record<string, unknown>,
  token: TokenSource = ghToken,
): Promise<{ token: string; login: string }> {
  const t = params.token ? String(params.token) : await token()
  if (!t)
    throw new Error("no GitHub token: run `gh auth login` on this machine, or set params.token")
  if (params.login) return { token: t, login: String(params.login) }
  const me = await graphql<{ viewer: { login: string } }>(t, "query { viewer { login } }", {})
  return { token: t, login: me.viewer.login }
}

// Reads open PRs authored by and awaiting review from the login, normalized to
// pr items. Params are optional: { token, login } override the machine's `gh`
// login.
export function githubProvider(token: TokenSource = ghToken): Provider {
  return {
    source: "code",
    async read(config: InstanceConfig): Promise<ProviderResult> {
      const auth = await credentials(config.params ?? {}, token)
      const [mine, review] = await Promise.all([
        graphql(auth.token, QUERY, {
          q: `is:pr is:open archived:false author:${auth.login}`,
          first: 50,
        }),
        graphql(auth.token, QUERY, {
          q: `is:pr is:open archived:false user-review-requested:${auth.login}`,
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
}

export const github = githubProvider()
