import type { Item } from "@periapsis/core"

// One configured instance of a provider: which provider, a label that
// identifies this instance, and provider-specific params and credentials.
export interface InstanceConfig {
  provider: string
  instance: string
  params: Record<string, unknown>
}

// The item a provider returns before the reporter stamps account/source keys.
// The provider supplies a local key; the reporter namespaces it by instance so
// two instances of one provider never collide.
export interface ProviderItem {
  key: string
  kind: Item["kind"]
  priority?: 1 | 2 | 3
  title: string
  detail?: string
  url?: string
  group?: string
  fingerprint: string
  meta?: Record<string, string>
}

export interface ProviderResult {
  items: ProviderItem[]
}

// A provider reads one vendor instance and returns normalized items of its kind.
// It throws to signal the instance could not be read; the reporter marks that
// instance failed without sinking the others.
export interface Provider {
  // The abstract source this provider reports under (e.g. "github", "jira").
  readonly source: string
  read(config: InstanceConfig): Promise<ProviderResult>
}

export interface AccountConfig {
  account: string
  instances: InstanceConfig[]
}
