import type { Item } from "@periapsis/core"
import type { InstanceConfig, Provider, ProviderItem } from "./provider.js"

export interface SourceSnapshot {
  source: string
  items: Item[]
  failed: boolean
  note: string | null
}

function toItem(raw: ProviderItem, account: string, source: string, instance: string): Item {
  return {
    key: `${account}:${source}:${instance}/${raw.key}`,
    kind: raw.kind,
    priority: raw.priority ?? 2,
    title: raw.title,
    detail: raw.detail ?? null,
    url: raw.url ?? null,
    group: raw.group ?? null,
    fingerprint: raw.fingerprint,
    meta: { ...raw.meta, instance },
  }
}

// Runs every instance of one source and merges results. If one instance throws,
// its failure is recorded but the others still contribute. If every instance
// fails, the source is marked failed so the hub keeps its prior items.
export async function collectSource(
  account: string,
  provider: Provider,
  instances: InstanceConfig[],
): Promise<SourceSnapshot> {
  const items: Item[] = []
  const failures: string[] = []
  for (const cfg of instances) {
    try {
      const result = await provider.read(cfg)
      for (const raw of result.items) {
        items.push(toItem(raw, account, provider.source, cfg.instance))
      }
    } catch (err) {
      failures.push(`${cfg.instance}: ${(err as Error).message}`)
    }
  }
  const allFailed = failures.length === instances.length && instances.length > 0
  return {
    source: provider.source,
    items,
    failed: allFailed,
    note: failures.length ? failures.join("; ") : null,
  }
}
