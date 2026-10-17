import type { Item } from "@periapsis/core"
import type { ProviderItem } from "./provider.js"

export function toItem(raw: ProviderItem, account: string, source: string, instance: string): Item {
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
