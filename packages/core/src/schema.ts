import { isId, safeLink } from "./ids.js"
import { isKind } from "./kind.js"

export class SchemaError extends Error {}

export interface Item {
  key: string
  kind: string
  priority: 1 | 2 | 3
  title: string
  detail: string | null
  url: string | null
  group: string | null
  fingerprint: string
  meta: Record<string, string>
}

export interface Snapshot {
  account: string
  source: string
  at: number
  items: Item[]
  note: string | null
  failed: boolean
}

const MAX_ITEMS = 300

function str(value: unknown, max: number, field: string, required = false): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new SchemaError(`${field} is required`)
    return null
  }
  if (typeof value !== "string") throw new SchemaError(`${field} must be a string`)
  return value.slice(0, max)
}

function meta(value: unknown, field: string): Record<string, string> {
  if (value === undefined || value === null) return {}
  if (typeof value !== "object" || Array.isArray(value))
    throw new SchemaError(`${field} must be an object`)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
    if (typeof v !== "string") throw new SchemaError(`${field}.${k} must be a string`)
    out[k.slice(0, 60)] = v.slice(0, 300)
  }
  return out
}

function item(raw: unknown, i: number, account: string, source: string): Item {
  if (!raw || typeof raw !== "object") throw new SchemaError(`items[${i}] must be an object`)
  const r = raw as Record<string, unknown>
  const f = `items[${i}]`
  const localKey = str(r.key, 300, `${f}.key`, true) as string
  const kind = str(r.kind, 40, `${f}.kind`) ?? source
  if (!isKind(kind)) throw new SchemaError(`${f}.kind "${kind}" is not a known kind`)
  const p = r.priority ?? 2
  if (p !== 1 && p !== 2 && p !== 3) throw new SchemaError(`${f}.priority must be 1, 2 or 3`)
  return {
    key: `${account}:${source}:${localKey}`,
    kind,
    priority: p,
    title: str(r.title, 300, `${f}.title`, true) as string,
    detail: str(r.detail, 600, `${f}.detail`),
    url: safeLink(r.url),
    group: str(r.group, 120, `${f}.group`),
    fingerprint: str(r.fingerprint, 300, `${f}.fingerprint`, true) as string,
    meta: meta(r.meta, `${f}.meta`),
  }
}

export function validateSnapshot(body: unknown, now: number): Snapshot {
  if (!body || typeof body !== "object") throw new SchemaError("body must be an object")
  const b = body as Record<string, unknown>
  const account = str(b.account, 31, "account", true) as string
  const source = str(b.source, 31, "source", true) as string
  if (!isId(account)) throw new SchemaError("account must be lowercase letters, digits or dashes")
  if (!isId(source)) throw new SchemaError("source must be lowercase letters, digits or dashes")
  const note = str(b.note, 500, "note")
  if (b.failed === true) return { account, source, at: now, items: [], note, failed: true }
  if (!Array.isArray(b.items))
    throw new SchemaError(
      "items must be an array; send failed: true if the source could not be read",
    )
  if (b.items.length > MAX_ITEMS)
    throw new SchemaError(`items has ${b.items.length} entries; the limit is ${MAX_ITEMS}`)
  const items = b.items.map((x, i) => item(x, i, account, source))
  const keys = new Set<string>()
  for (const it of items) {
    if (keys.has(it.key)) throw new SchemaError(`duplicate item key ${it.key}`)
    keys.add(it.key)
  }
  return { account, source, at: now, items, note, failed: false }
}
