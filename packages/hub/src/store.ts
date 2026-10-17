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
  url: string | null
  grp: string | null
  priority: number
  fingerprint: string
  status: Status
  hidden_until: number | null
  resolved_at: number | null
  meta: string
}

export interface Reporter {
  account: string
  source: string
  lastSeen: number
}

export interface Store {
  reconcile(account: string, source: string, items: Item[], now: number): void
  reporters(): Reporter[]
  act(
    account: string,
    source: string,
    key: string,
    action: string,
    now: number,
    until?: number,
  ): Row | null
  list(): Row[]
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
  `)

  const get = db.prepare("SELECT * FROM items WHERE account=? AND source=? AND key=?")
  const insert = db.prepare(`
    INSERT INTO items (account, source, key, kind, title, detail, url, grp, priority, fingerprint, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const refresh = db.prepare(`
    UPDATE items SET kind=?, title=?, detail=?, url=?, grp=?, priority=?, fingerprint=?, meta=?
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
    "INSERT INTO sources (account, source, last_seen) VALUES (?, ?, ?) ON CONFLICT (account, source) DO UPDATE SET last_seen=excluded.last_seen",
  )
  const allSources = db.prepare("SELECT account, source, last_seen AS lastSeen FROM sources")

  function localKey(fullKey: string): string {
    const parts = fullKey.split(":")
    return parts.slice(2).join(":")
  }

  function reconcile(account: string, source: string, items: Item[], now: number): void {
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
          item.url,
          item.group,
          item.priority,
          item.fingerprint,
          metaJson,
          account,
          source,
          key,
        )
        if (row.status === "resolved") {
          setStatus.run("active", null, null, account, source, key)
        }
      }
      for (const row of bySource.all(account, source) as unknown as Row[]) {
        if (!seen.has(row.key)) setStatus.run("resolved", null, now, account, source, row.key)
      }
      touchSource.run(account, source, now)
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
    list: () => all.all() as unknown as Row[],
    reporters: () => allSources.all() as unknown as Reporter[],
    close: () => db.close(),
  }
}
