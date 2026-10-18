import type { InstanceConfig, Provider, ProviderItem, ProviderResult } from "../provider.js"
import { fetchJson, secret } from "./http.js"

const ENDPOINT = "https://api.linear.app/graphql"
const DAY = 86_400_000
const OPEN = '{ type: { nin: ["completed", "canceled"] } }'

const ISSUES = `query {
  viewer { assignedIssues(first: 100, filter: { state: ${OPEN} }) { nodes {
    identifier title url dueDate updatedAt state { name type } project { name }
  } } }
}`

const PROJECTS = `query {
  projects(first: 25, filter: {
    or: [{ lead: { isMe: { eq: true } } }, { members: { some: { isMe: { eq: true } } } }]
    status: ${OPEN}
  }) { nodes {
    id name url progress targetDate health updatedAt
    status { name type }
    lead { name isMe }
    lastUpdate { createdAt health url body }
    issues(first: 50, filter: { state: ${OPEN} }) { nodes { assignee { isMe } } }
  } }
}`

export interface LinearIssue {
  identifier: string
  title: string
  url: string
  dueDate?: string | null
  updatedAt: string
  state: { name: string; type: string }
  project?: { name: string } | null
}

export interface LinearProject {
  id: string
  name: string
  url: string
  progress: number
  targetDate?: string | null
  health?: string | null
  updatedAt: string
  status: { name: string; type: string }
  lead?: { name: string; isMe: boolean } | null
  lastUpdate?: { createdAt: string; health?: string | null; url: string; body?: string } | null
  issues: { nodes: { assignee?: { isMe: boolean } | null }[] }
}

async function query<T>(apiKey: string, q: string): Promise<T> {
  // A personal API key goes in the header as is, without "Bearer".
  const res = await fetchJson<{ data?: T; errors?: { message: string }[] }>(ENDPOINT, {
    method: "POST",
    headers: { authorization: apiKey, "content-type": "application/json" },
    body: JSON.stringify({ query: q }),
  })
  if (res.errors?.length) throw new Error(`Linear: ${res.errors.map((e) => e.message).join("; ")}`)
  if (!res.data) throw new Error("Linear returned no data")
  return res.data
}

function today(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

// Started or due by today is urgent; open is this week; backlog is whenever.
export function linearIssueItem(i: LinearIssue, instance: string, now: Date): ProviderItem {
  const due = i.dueDate ?? null
  const priority: 1 | 2 | 3 =
    i.state.type === "started" || (due && due <= today(now))
      ? 1
      : i.state.type === "backlog"
        ? 3
        : 2
  return {
    key: i.identifier,
    kind: "ticket",
    priority,
    title: i.title,
    detail: [i.identifier, i.state.name, due ? `due ${due}` : ""].filter(Boolean).join(" · "),
    url: i.url,
    group: i.project?.name,
    fingerprint: i.updatedAt,
    meta: { instance, ref: i.identifier, status: i.state.name, ...(due ? { due } : {}) },
  }
}

// A project you lead asks for an update when it has started and its last
// update is more than a week old.
export function linearProjectItem(p: LinearProject, instance: string, now: number): ProviderItem {
  const isLead = p.lead?.isMe === true
  const last = p.lastUpdate?.createdAt
  const stale = !last || now - Date.parse(last) > 7 * DAY
  const action = isLead && p.status.type === "started" && stale ? "Post a project update" : null
  const health = p.lastUpdate?.health ?? p.health ?? "none"
  const forYou = p.issues.nodes.filter((n) => n.assignee?.isMe).length
  return {
    key: p.id,
    kind: "project",
    priority: action || health === "atRisk" || health === "offTrack" ? 1 : 2,
    title: p.name,
    detail: p.status.name,
    ...(p.lastUpdate?.body ? { body: p.lastUpdate.body.slice(0, 4000) } : {}),
    url: p.url,
    group: p.status.name,
    fingerprint: `${last ?? p.updatedAt}:${p.progress.toFixed(2)}`,
    meta: {
      instance,
      health,
      progress: p.progress.toFixed(2),
      ...(p.targetDate ? { target: p.targetDate } : {}),
      status: p.status.name,
      ...(p.lead ? { lead: p.lead.name } : {}),
      isLead: String(isLead),
      ...(last ? { lastUpdate: last } : {}),
      issues: String(p.issues.nodes.length),
      forYou: String(forYou),
      ...(action ? { action } : {}),
    },
  }
}

// Params: { apiKey (or apiKeyFile / apiKeyEnv) }. Reads the Linear issues
// assigned to you that are not completed or canceled.
export const linear: Provider = {
  source: "tickets",
  async read(config: InstanceConfig): Promise<ProviderResult> {
    const data = await query<{ viewer: { assignedIssues: { nodes: LinearIssue[] } } }>(
      await secret(config.params ?? {}, "apiKey"),
      ISSUES,
    )
    const now = new Date()
    return {
      items: data.viewer.assignedIssues.nodes.map((i) => linearIssueItem(i, config.instance, now)),
    }
  },
}

// Params: { apiKey (or apiKeyFile / apiKeyEnv) }. Reads the Linear projects you
// lead or are a member of that are not completed or canceled, with their
// health, progress, latest update and open issues.
export const linearProjects: Provider = {
  source: "projects",
  async read(config: InstanceConfig): Promise<ProviderResult> {
    const data = await query<{ projects: { nodes: LinearProject[] } }>(
      await secret(config.params ?? {}, "apiKey"),
      PROJECTS,
    )
    const now = Date.now()
    return { items: data.projects.nodes.map((p) => linearProjectItem(p, config.instance, now)) }
  },
}
