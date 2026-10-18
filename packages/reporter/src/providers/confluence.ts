import type { InstanceConfig, Provider, ProviderItem, ProviderResult } from "../provider.js"
import { basicAuth, fetchJson, secret } from "./http.js"
import { siteOrigin } from "./jira.js"

const DAY = 86_400_000
const MAX_PAGES = 30

interface SearchResult {
  results: { id: string; title: string; _links?: { webui?: string }; version?: { when?: string } }[]
  _links?: { base?: string }
}

interface Comment {
  id: string
  resolutionStatus?: string
  version?: { authorId?: string; createdAt?: string }
}

export interface PageFacts {
  id: string
  title: string
  url: string
  edited: string
  mentioned: boolean
  comments: Comment[]
}

// One item per page: its open comments, the ones from others that may need
// you, and whether it mentions you.
export function pageItem(p: PageFacts, me: string, instance: string): ProviderItem {
  const open = p.comments.filter((c) => (c.resolutionStatus ?? "open") === "open")
  const toAnswer = open.filter((c) => c.version?.authorId && c.version.authorId !== me).length
  const action = toAnswer
    ? `Answer ${toAnswer} comment thread${toAnswer > 1 ? "s" : ""}`
    : p.mentioned
      ? "Read the mention"
      : null
  const latest = open
    .map((c) => c.version?.createdAt ?? "")
    .sort()
    .at(-1)
  return {
    key: p.id,
    kind: "doc",
    priority: toAnswer ? 1 : p.mentioned ? 2 : 3,
    title: p.title,
    detail: action ? `${action}${p.mentioned && toAnswer ? " · mentions you" : ""}` : undefined,
    url: p.url,
    fingerprint: `${p.edited}:${latest ?? ""}:${open.length}`,
    meta: {
      instance,
      edited: p.edited,
      threads: String(open.length),
      toAnswer: String(toAnswer),
      ...(action ? { action } : {}),
    },
  }
}

// Params: { site, email, token (or tokenFile / tokenEnv), days?, cql? }. Reads
// Confluence Cloud pages that mention you or that you created or edited in the
// last `days` (default 30), with their open inline and footer comments. One
// instance per Confluence site.
export const confluence: Provider = {
  source: "docs",
  async read(config: InstanceConfig): Promise<ProviderResult> {
    const params = config.params ?? {}
    const origin = siteOrigin(params.site)
    const email = String(params.email ?? "")
    if (!email) throw new Error("needs email, the Atlassian account's address")
    const auth = basicAuth(email, await secret(params, "token"))
    const get = <T>(path: string) =>
      fetchJson<T>(`${origin}/wiki${path}`, { headers: { authorization: auth } })
    const since = new Date(Date.now() - (Number(params.days) || 30) * DAY)
      .toISOString()
      .slice(0, 10)
    const search = (cql: string) =>
      get<SearchResult>(
        `/rest/api/content/search?limit=50&expand=version&cql=${encodeURIComponent(cql)}`,
      )
    const me = (await get<{ accountId: string }>("/rest/api/user/current")).accountId
    const mine =
      typeof params.cql === "string" && params.cql
        ? params.cql
        : `type=page AND contributor = currentUser() AND lastmodified >= "${since}"`
    const [mentions, pages] = await Promise.all([
      search(`type=page AND mention = currentUser() AND lastmodified >= "${since}"`),
      search(mine),
    ])
    const mentioned = new Set(mentions.results.map((r) => r.id))
    const byId = new Map([...pages.results, ...mentions.results].map((r) => [r.id, r]))
    const base = pages._links?.base ?? mentions._links?.base ?? `${origin}/wiki`
    const items: ProviderItem[] = []
    for (const r of [...byId.values()].slice(0, MAX_PAGES)) {
      const [inline, footer] = await Promise.all([
        get<{ results: Comment[] }>(`/api/v2/pages/${r.id}/inline-comments?limit=100`),
        get<{ results: Comment[] }>(`/api/v2/pages/${r.id}/footer-comments?limit=100`),
      ])
      const facts: PageFacts = {
        id: r.id,
        title: r.title,
        url: `${base}${r._links?.webui ?? ""}`,
        edited: r.version?.when ?? "",
        mentioned: mentioned.has(r.id),
        comments: [...inline.results, ...footer.results],
      }
      items.push(pageItem(facts, me, config.instance))
    }
    return { items }
  },
}
