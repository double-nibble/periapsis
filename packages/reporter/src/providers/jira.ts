import type { InstanceConfig, Provider, ProviderItem, ProviderResult } from "../provider.js"
import { basicAuth, fetchJson, secret } from "./http.js"

const DEFAULT_JQL = "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC"
const LIMIT = 300

interface JiraIssue {
  key: string
  fields: {
    summary?: string
    status?: { name?: string; statusCategory?: { key?: string } }
    duedate?: string | null
    priority?: { name?: string } | null
    updated?: string
    project?: { name?: string }
  }
}

interface SearchPage {
  issues?: JiraIssue[]
  nextPageToken?: string
  isLast?: boolean
}

// "acme.atlassian.net" or "https://acme.atlassian.net/" as an https origin.
export function siteOrigin(site: unknown): string {
  const host = String(site ?? "")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host))
    throw new Error("needs site, such as acme.atlassian.net")
  return `https://${host}`
}

function localDay(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

// In progress or due by today is urgent; open is this week; backlog is whenever.
export function issueItem(
  issue: JiraIssue,
  origin: string,
  instance: string,
  now: Date,
): ProviderItem {
  const f = issue.fields
  const category = f.status?.statusCategory?.key
  const status = f.status?.name ?? ""
  const due = f.duedate ?? null
  const priority: 1 | 2 | 3 =
    (due && due <= localDay(now)) || category === "indeterminate"
      ? 1
      : /backlog/i.test(status)
        ? 3
        : 2
  return {
    key: issue.key,
    kind: "ticket",
    priority,
    title: f.summary ?? issue.key,
    detail: [issue.key, status, due ? `due ${due}` : ""].filter(Boolean).join(" · "),
    url: `${origin}/browse/${issue.key}`,
    group: f.project?.name,
    fingerprint: f.updated ?? issue.key,
    meta: {
      instance,
      site: new URL(origin).host,
      ref: issue.key,
      status,
      ...(due ? { due } : {}),
      ...(f.priority?.name ? { jiraPriority: f.priority.name } : {}),
    },
  }
}

// Params: { site, email, token (or tokenFile / tokenEnv), jql? }. Reads the
// issues assigned to you that are not done, or those matching jql. One
// instance per Jira site.
export const jira: Provider = {
  source: "tickets",
  async read(config: InstanceConfig): Promise<ProviderResult> {
    const params = config.params ?? {}
    const origin = siteOrigin(params.site)
    const email = String(params.email ?? "")
    if (!email) throw new Error("needs email, the Atlassian account's address")
    const auth = basicAuth(email, await secret(params, "token"))
    const jql = typeof params.jql === "string" && params.jql ? params.jql : DEFAULT_JQL
    const issues: JiraIssue[] = []
    let next: string | undefined
    do {
      const q = new URLSearchParams({
        jql,
        fields: "summary,status,duedate,priority,updated,project",
        maxResults: "100",
        ...(next ? { nextPageToken: next } : {}),
      })
      const page = await fetchJson<SearchPage>(`${origin}/rest/api/3/search/jql?${q}`, {
        headers: { authorization: auth },
      })
      issues.push(...(page.issues ?? []))
      next = page.isLast ? undefined : page.nextPageToken
    } while (next && issues.length < LIMIT)
    const now = new Date()
    return { items: issues.slice(0, LIMIT).map((i) => issueItem(i, origin, config.instance, now)) }
  },
}
