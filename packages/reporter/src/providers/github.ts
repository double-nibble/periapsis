import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { InstanceConfig, Provider, ProviderResult } from "../provider.js"

import { type PrNode, normalizePr, prItem } from "./github-pr.js"

const ENDPOINT = "https://api.github.com/graphql"

const QUERY = `
query($q: String!, $first: Int!) {
  search(query: $q, type: ISSUE, first: $first) {
    nodes { ... on PullRequest {
      number title url isDraft createdAt additions deletions baseRefName headRefOid
      repository { nameWithOwner defaultBranchRef { name } }
      author { __typename login }
      reviewDecision mergeStateStatus
      reviewRequests(first: 20) {
        nodes { requestedReviewer { ... on User { login } ... on Team { slug } } }
      }
      latestReviews(first: 20) { nodes { state submittedAt author { __typename login } } }
      reviewThreads(first: 50) {
        nodes { isResolved comments(last: 1) { nodes { id author { __typename login } } } }
      }
      commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
        __typename
        ... on CheckRun { name status conclusion }
        ... on StatusContext { context state }
      } } } } } }
    } }
  }
}`

// GitHub answers a long-running search with a 5xx, so those are retried.
async function graphql<T = { search: { nodes: PrNode[] } }>(
  token: string,
  q: string,
  variables: object,
  attempt = 0,
): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { authorization: `bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: q, variables }),
  })
  if (res.status >= 500 && attempt < 2) {
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    return graphql(token, q, variables, attempt + 1)
  }
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] }
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "))
  if (!json.data) throw new Error("GitHub API returned no data")
  return json.data
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

// Reads open PRs authored by and awaiting review from the login, one item per
// PR titled with what to do next. Params are optional: { token, login }
// override the machine's `gh` login.
export function githubProvider(token: TokenSource = ghToken): Provider {
  return {
    source: "code",
    async read(config: InstanceConfig): Promise<ProviderResult> {
      const auth = await credentials(config.params ?? {}, token)
      const search = (q: string, first: number) =>
        graphql(auth.token, QUERY, { q: `is:pr is:open archived:false ${q}`, first })
      const [mine, review] = await Promise.all([
        search(`author:${auth.login}`, 50),
        search(`user-review-requested:${auth.login}`, 30),
      ])
      const now = Date.now()
      const authored = new Set(mine.search.nodes.map((n) => n?.url))
      const items = [
        ...mine.search.nodes
          .filter((n) => n?.url)
          .map((n) => prItem(normalizePr(n, auth.login), "author", config.instance, now)),
        ...review.search.nodes
          .filter((n) => n?.url && !n.isDraft && !authored.has(n.url))
          .map((n) => prItem(normalizePr(n, auth.login), "reviewer", config.instance, now)),
      ]
      return { items }
    },
  }
}

export const github = githubProvider()
