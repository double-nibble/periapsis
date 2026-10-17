import type { Reporter, Row } from "./store.js"

export interface ModelItem {
  account: string
  source: string
  key: string
  kind: string
  title: string
  detail: string | null
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

export interface Model {
  generatedAt: number
  accounts: AccountModel[]
  schedule: ScheduleEntry[]
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
    url: row.url,
    group: row.grp,
    priority: row.priority,
    meta,
  }
}

const byPriority = (a: ModelItem, b: ModelItem) =>
  a.priority - b.priority || a.key.localeCompare(b.key)

export function buildModel(rows: Row[], now: number, reporters: Reporter[] = []): Model {
  const active = rows.filter((r) => r.status === "active").map(toItem)

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

  return {
    generatedAt: now,
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
