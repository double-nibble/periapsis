import type { InstanceConfig, Provider, ProviderResult } from "../provider.js"
import { type Pr, prItem } from "./github-pr.js"
import { basicAuth, fetchJson, secret } from "./http.js"

const API = "https://api.bitbucket.org/2.0"
const FAILED = new Set(["FAILED", "STOPPED"])

interface User {
  uuid: string
  nickname?: string
  display_name?: string
}

interface Participant {
  user: User
  role: "PARTICIPANT" | "REVIEWER"
  approved: boolean
  state: "approved" | "changes_requested" | null
  participated_on?: string
}

export interface BbPr {
  id: number
  title: string
  draft?: boolean
  created_on: string
  author: User
  source: { branch: { name: string }; commit?: { hash: string } }
  destination: { branch: { name: string } }
  participants?: Participant[]
  links: { html: { href: string } }
}

export interface BbStatus {
  state: string
  name?: string
  key?: string
}

export interface BbComment {
  id: number
  user: User
  created_on: string
  parent?: { id: number }
  resolution?: unknown
  deleted?: boolean
}

interface Page<T> {
  values: T[]
  next?: string
}

const name = (u: User) => u.nickname ?? u.display_name ?? "someone"

async function all<T>(url: string, auth: string, max = 500): Promise<T[]> {
  const out: T[] = []
  let next: string | undefined = url
  while (next && out.length < max) {
    const page: Page<T> = await fetchJson<Page<T>>(next, { headers: { authorization: auth } })
    out.push(...page.values)
    next = page.next
  }
  return out
}

// Unresolved threads, and those whose latest comment is from someone else.
export function threads(
  comments: BbComment[],
  me: string,
): { open: number; awaiting: BbComment[] } {
  const byId = new Map(comments.map((c) => [c.id, c]))
  const root = (c: BbComment): BbComment => {
    let at = c
    while (at.parent && byId.has(at.parent.id)) at = byId.get(at.parent.id) as BbComment
    return at
  }
  const latest = new Map<number, BbComment>()
  for (const c of comments) {
    if (c.deleted) continue
    const r = root(c)
    const prev = latest.get(r.id)
    if (!prev || c.created_on > prev.created_on) latest.set(r.id, c)
  }
  const open = [...latest.entries()].filter(([id]) => !byId.get(id)?.resolution)
  return { open: open.length, awaiting: open.map(([, c]) => c).filter((c) => c.user.uuid !== me) }
}

export function normalizeBb(
  pr: BbPr,
  repo: string,
  mainBranch: string,
  statuses: BbStatus[],
  comments: BbComment[],
  me: string,
): Pr {
  const people = pr.participants ?? []
  const changes = people.filter((p) => p.state === "changes_requested")
  const approved = people.filter((p) => p.approved || p.state === "approved")
  const t = threads(comments, me)
  const base = pr.destination.branch.name
  return {
    repo,
    number: pr.id,
    title: pr.title,
    url: pr.links.html.href,
    author: name(pr.author),
    isDraft: pr.draft === true,
    createdAt: pr.created_on,
    additions: null,
    deletions: null,
    stackedOn: base === mainBranch ? null : base,
    headOid: pr.source.commit?.hash ?? pr.source.branch.name,
    reviewDecision: changes.length ? "CHANGES_REQUESTED" : approved.length ? "APPROVED" : null,
    mergeState: null,
    reviewers: people.filter((p) => p.role === "REVIEWER" && !p.approved).map((p) => name(p.user)),
    approvedBy: approved.map((p) => name(p.user)),
    changesAt:
      changes
        .map((p) => p.participated_on ?? "")
        .sort()
        .at(-1) || null,
    failed: statuses.filter((s) => FAILED.has(s.state)).map((s) => s.name ?? s.key ?? "build"),
    pending: statuses.filter((s) => s.state === "INPROGRESS").length,
    checks: statuses.length,
    openThreads: t.open,
    awaitingReply: t.awaiting.map((c) => ({ id: String(c.id), login: name(c.user) })),
  }
}

// Params: { repos: ["workspace/repo", …], token (or tokenFile / tokenEnv),
// email? }. Reads the open PRs you authored or are reviewing in each repository,
// one item per PR titled with what to do next. With email the token is sent as
// basic auth; without it, as a bearer token.
export const bitbucket: Provider = {
  source: "code",
  async read(config: InstanceConfig): Promise<ProviderResult> {
    const params = config.params ?? {}
    const repos = Array.isArray(params.repos) ? params.repos.map(String) : []
    if (!repos.length) throw new Error('needs repos, such as ["acme/api"]')
    const token = await secret(params, "token")
    const auth = params.email ? basicAuth(String(params.email), token) : `Bearer ${token}`
    const get = <T>(url: string) => fetchJson<T>(url, { headers: { authorization: auth } })
    const me = await get<User>(`${API}/user`)
    const now = Date.now()
    const items = []
    for (const repo of repos) {
      const base = `${API}/repositories/${repo}`
      const info = await get<{ mainbranch?: { name: string } }>(base)
      const q = `state="OPEN" AND (draft=true OR draft=false) AND (author.uuid="${me.uuid}" OR reviewers.uuid="${me.uuid}")`
      const list = await all<{ id: number }>(
        `${base}/pullrequests?pagelen=50&q=${encodeURIComponent(q)}`,
        auth,
        100,
      )
      for (const { id } of list) {
        const [pr, statuses, comments] = await Promise.all([
          get<BbPr>(`${base}/pullrequests/${id}`),
          all<BbStatus>(`${base}/pullrequests/${id}/statuses?pagelen=100`, auth),
          all<BbComment>(`${base}/pullrequests/${id}/comments?pagelen=100`, auth),
        ])
        const role = pr.author.uuid === me.uuid ? "author" : "reviewer"
        if (role === "reviewer" && pr.draft) continue
        const norm = normalizeBb(
          pr,
          repo,
          info.mainbranch?.name ?? "main",
          statuses,
          comments,
          me.uuid,
        )
        items.push(prItem(norm, role, config.instance, now))
      }
    }
    return { items }
  },
}
