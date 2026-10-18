import { DatabaseSync } from "node:sqlite"
import type { Item } from "@periapsis/core"

const DAY = 86_400_000
const PRUNE_AFTER_MS = 30 * DAY

export type Status = "active" | "snoozed" | "dismissed" | "done" | "resolved"

export interface Row {
  account: string
  source: string
  key: string
  kind: string
  title: string
  detail: string | null
  body: string | null
  url: string | null
  grp: string | null
  priority: number
  fingerprint: string
  status: Status
  hidden_until: number | null
  resolved_at: number | null
  meta: string
}

// What the hub last heard from one account's source: when, when it last
// succeeded, why it failed if it did, and any note about part of it failing.
export interface Reporter {
  account: string
  source: string
  lastSeen: number
  okAt: number | null
  error: string | null
  note: string | null
}

export interface Store {
  reconcile(account: string, source: string, items: Item[], now: number, note?: string | null): void
  sourceFailed(account: string, source: string, error: string, now: number): void
  reporters(): Reporter[]
  act(
    account: string,
    source: string,
    key: string,
    action: string,
    now: number,
    until?: number,
  ): Row | null
  get(account: string, source: string, key: string): Row | null
  list(): Row[]
  // Small JSON values the hub keeps, such as the latest daily plan.
  getState<T>(name: string): T | null
  setState(name: string, value: unknown): void
  close(): void
}

export function openStore(path: string): Store {
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS items (
      account TEXT NOT NULL,
      source TEXT NOT NULL,
      key TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      url TEXT,
      grp TEXT,
      priority INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      hidden_until INTEGER,
      resolved_at INTEGER,
      meta TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (account, source, key)
    );
    CREATE TABLE IF NOT EXISTS sources (
      account TEXT NOT NULL,
      source TEXT NOT NULL,
      last_seen INTEGER NOT NULL,
      PRIMARY KEY (account, source)
    );
    CREATE TABLE IF NOT EXISTS state (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  const columns = db.prepare("PRAGMA table_info(items)").all() as { name: string }[]
  if (!columns.some((c) => c.name === "body")) db.exec("ALTER TABLE items ADD COLUMN body TEXT")
  const sourceColumns = db.prepare("PRAGMA table_info(sources)").all() as { name: string }[]
  for (const [col, type] of [
    ["ok_at", "INTEGER"],
    ["error", "TEXT"],
    ["note", "TEXT"],
  ])
    if (!sourceColumns.some((c) => c.name === col))
      db.exec(`ALTER TABLE sources ADD COLUMN ${col} ${type}`)

  const get = db.prepare("SELECT * FROM items WHERE account=? AND source=? AND key=?")
  const insert = db.prepare(`
    INSERT INTO items (account, source, key, kind, title, detail, body, url, grp, priority, fingerprint, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const refresh = db.prepare(`
    UPDATE items SET kind=?, title=?, detail=?, body=?, url=?, grp=?, priority=?, fingerprint=?, meta=?
    WHERE account=? AND source=? AND key=?
  `)
  const setStatus = db.prepare(
    "UPDATE items SET status=?, hidden_until=?, resolved_at=? WHERE account=? AND source=? AND key=?",
  )
  const bySource = db.prepare(
    "SELECT * FROM items WHERE account=? AND source=? AND status != 'resolved'",
  )
  const prune = db.prepare("DELETE FROM items WHERE status='resolved' AND resolved_at < ?")
  const all = db.prepare("SELECT * FROM items")
  const touchSource = db.prepare(
    "INSERT INTO sources (account, source, last_seen, ok_at, error, note) VALUES (?, ?, ?, ?, NULL, ?) ON CONFLICT (account, source) DO UPDATE SET last_seen=excluded.last_seen, ok_at=excluded.ok_at, error=NULL, note=excluded.note",
  )
  const failSource = db.prepare(
    "INSERT INTO sources (account, source, last_seen, error) VALUES (?, ?, ?, ?) ON CONFLICT (account, source) DO UPDATE SET last_seen=excluded.last_seen, error=excluded.error",
  )
  const allSources = db.prepare(
    "SELECT account, source, last_seen AS lastSeen, ok_at AS okAt, error, note FROM sources",
  )
  const readState = db.prepare("SELECT value FROM state WHERE name=?")
  const writeState = db.prepare(
    "INSERT INTO state (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value=excluded.value",
  )

  function localKey(fullKey: string): string {
    const parts = fullKey.split(":")
    return parts.slice(2).join(":")
  }

  function reconcile(
    account: string,
    source: string,
    items: Item[],
    now: number,
    note: string | null = null,
  ): void {
    const seen = new Set<string>()
    db.exec("BEGIN")
    try {
      for (const item of items) {
        const key = localKey(item.key)
        seen.add(key)
        const metaJson = JSON.stringify(item.meta)
        const row = get.get(account, source, key) as unknown as Row | undefined
        if (!row) {
          insert.run(
            account,
            source,
            key,
            item.kind,
            item.title,
            item.detail,
            item.body ?? null,
            item.url,
            item.group,
            item.priority,
            item.fingerprint,
            metaJson,
          )
          continue
        }
        refresh.run(
          item.kind,
          item.title,
          item.detail,
          item.body ?? null,
          item.url,
          item.group,
          item.priority,
          item.fingerprint,
          metaJson,
          account,
          source,
          key,
        )
        // A resolved item that reappears, or a hidden one with new activity,
        // needs attention again.
        if (
          row.status === "resolved" ||
          (row.status !== "active" && row.fingerprint !== item.fingerprint)
        )
          setStatus.run("active", null, null, account, source, key)
      }
      for (const row of bySource.all(account, source) as unknown as Row[]) {
        if (!seen.has(row.key)) setStatus.run("resolved", null, now, account, source, row.key)
      }
      touchSource.run(account, source, now, now, note)
      prune.run(now - PRUNE_AFTER_MS)
      db.exec("COMMIT")
    } catch (err) {
      db.exec("ROLLBACK")
      throw err
    }
  }

  function act(
    account: string,
    source: string,
    key: string,
    action: string,
    now: number,
    until?: number,
  ): Row | null {
    const row = get.get(account, source, key) as unknown as Row | undefined
    if (!row) return null
    if (action === "dismiss") setStatus.run("dismissed", now + DAY, null, account, source, key)
    else if (action === "snooze") {
      if (!until || until <= now) throw new Error("snooze needs a future time")
      setStatus.run("snoozed", until, null, account, source, key)
    } else if (action === "done") setStatus.run("done", null, null, account, source, key)
    else if (action === "restore") setStatus.run("active", null, null, account, source, key)
    else throw new Error(`unknown action ${action}`)
    return get.get(account, source, key) as unknown as Row
  }

  return {
    reconcile,
    act,
    get: (account, source, key) =>
      (get.get(account, source, key) as unknown as Row | undefined) ?? null,
    list: () => all.all() as unknown as Row[],
    sourceFailed: (account, source, error, now) => {
      failSource.run(account, source, now, error)
    },
    reporters: () => allSources.all() as unknown as Reporter[],
    getState: <T>(name: string) => {
      const row = readState.get(name) as { value: string } | undefined
      return row ? (JSON.parse(row.value) as T) : null
    },
    setState: (name, value) => {
      writeState.run(name, JSON.stringify(value))
    },
    close: () => db.close(),
  }
}
