import type { Briefing } from "./planner.js"
import type { Reporter, Row } from "./store.js"

export interface ModelItem {
  account: string
  source: string
  key: string
  kind: string
  title: string
  detail: string | null
  body: string | null
  url: string | null
  group: string | null
  priority: number
  meta: Record<string, string>
}

export interface AccountModel {
  account: string
  items: ModelItem[]
}

export interface ScheduleEntry {
  account: string
  title: string
  at: string
  url: string | null
}

export interface Stats {
  now: number
  needs: number
  later: number
  resolvedToday: number
  openPrs: number
  toReview: number
}

export interface Model {
  generatedAt: number
  accounts: AccountModel[]
  schedule: ScheduleEntry[]
  // Everything that needs the operator, across accounts, most urgent first.
  needs: ModelItem[]
  // Every open PR, project and RFC, including hidden ones, with its status.
  prs: (ModelItem & { status: string })[]
  projects: (ModelItem & { status: string })[]
  docs: (ModelItem & { status: string })[]
  stats: Stats
  // Each account's sources: when each last reported, and whether it failed.
  sources: Reporter[]
  // The latest daily plan, and whether a new one is being written.
  briefing: (Briefing & { running: boolean }) | null
}

function toItem(row: Row): ModelItem {
  let meta: Record<string, string> = {}
  try {
    meta = JSON.parse(row.meta)
  } catch {}
  return {
    account: row.account,
    source: row.source,
    key: row.key,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    body: row.body ?? null,
    url: row.url,
    group: row.grp,
    priority: row.priority,
    meta,
  }
}

const byPriority = (a: ModelItem, b: ModelItem) =>
  a.priority - b.priority || a.key.localeCompare(b.key)

// Kinds that have their own panel; one of them needs the operator only when
// it carries an action.
const RECORD_KINDS = new Set(["pr", "project", "doc"])

// A calendar event is shown on the calendar, and a PR, project or RFC with
// nothing to do is shown in its own panel; none of them needs the operator.
export function needsOperator(item: ModelItem): boolean {
  if (item.kind === "calendar") return false
  if (RECORD_KINDS.has(item.kind)) return Boolean(item.meta.action)
  return true
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function buildModel(rows: Row[], now: number, reporters: Reporter[] = []): Model {
  // A snoozed item comes back when its snooze ends.
  const shown = (r: Row) =>
    r.status === "active" || (r.status === "snoozed" && (r.hidden_until ?? 0) <= now)
  const active = rows.filter(shown).map(toItem)

  const accounts = new Map<string, ModelItem[]>()
  for (const r of reporters) if (!accounts.has(r.account)) accounts.set(r.account, [])
  for (const item of active) {
    const list = accounts.get(item.account) ?? []
    list.push(item)
    accounts.set(item.account, list)
  }

  const schedule: ScheduleEntry[] = active
    .filter((i) => i.kind === "calendar")
    .map((i) => ({ account: i.account, title: i.title, at: i.meta.at ?? "", url: i.url }))
    .sort((a, b) => a.at.localeCompare(b.at))

  const needs = active.filter(needsOperator).sort(byPriority)
  const records = (kind: string) =>
    rows
      .filter((r) => r.kind === kind && r.status !== "resolved")
      .map((r) => ({ ...toItem(r), status: r.status }))
      .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key))
  const prs = records("pr")
  const today = startOfDay(now)
  const stats: Stats = {
    now: needs.filter((i) => i.priority === 1).length,
    needs: needs.length,
    later: rows.filter((r) => r.status === "snoozed" && (r.hidden_until ?? 0) > now).length,
    resolvedToday: rows.filter((r) => r.status === "resolved" && (r.resolved_at ?? 0) >= today)
      .length,
    openPrs: prs.filter((p) => p.meta.role === "author").length,
    toReview: prs.filter((p) => p.meta.role === "reviewer").length,
  }

  return {
    generatedAt: now,
    needs,
    prs,
    projects: records("project"),
    docs: records("doc"),
    stats,
    sources: reporters
      .filter((r) => r.source !== "tasks")
      .sort((a, b) => a.account.localeCompare(b.account) || a.source.localeCompare(b.source)),
    briefing: null,
    accounts: [...accounts.entries()]
      .map(([account, items]) => ({ account, items: items.sort(byPriority) }))
      .sort((a, b) => a.account.localeCompare(b.account)),
    schedule,
  }
}

// The fleet aggregate: every active item in one list, each labeled by account.
export function aggregate(model: Model): ModelItem[] {
  return model.accounts.flatMap((a) => a.items).sort(byPriority)
}
