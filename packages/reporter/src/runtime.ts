import { type Item, type PublicIdentity, createLogger } from "@periapsis/core"
import type { Broker } from "@periapsis/transport"
import { type AgentRunner, collectAgentInstance } from "./agent/collect.js"
import { toItem } from "./collect.js"
import type { AccountConfig, InstanceConfig, Provider } from "./provider.js"
import { loadProvider } from "./providers/load.js"
import { publishStatus } from "./publish.js"

const log = createLogger("reporter")

export interface ReporterConfig {
  account: AccountConfig
  signPrivate: string
  hub: PublicIdentity
  everyMs?: number
  model?: string
  runAgent?: AgentRunner
}

export interface SourceResult {
  items: Item[]
  failed: boolean
  note: string | null
}

function sourceOf(inst: InstanceConfig, providers: Map<string, Provider>): string {
  if (inst.source) return inst.source
  return providers.get(inst.provider ?? "")?.source ?? ""
}

async function collectInstance(
  account: string,
  source: string,
  inst: InstanceConfig,
  providers: Map<string, Provider>,
  config: ReporterConfig,
): Promise<Item[]> {
  if (inst.mode === "agent") {
    return collectAgentInstance(account, source, inst, config.runAgent, config.model)
  }
  const provider = inst.module
    ? await loadProvider(inst.module)
    : providers.get(inst.provider ?? "")
  if (!provider) throw new Error(`no provider for ${inst.provider ?? inst.module}`)
  const result = await provider.read(inst)
  return result.items.map((raw) => toItem(raw, account, source, inst.instance))
}

// Collects every instance, routing each by mode (direct provider or agent) and
// grouping the results by source. A source is failed only when all of its
// instances failed, so the hub keeps its prior items.
export async function collectAll(
  providers: Map<string, Provider>,
  config: ReporterConfig,
  onError: (err: unknown) => void = () => {},
): Promise<Map<string, SourceResult>> {
  const account = config.account.account
  const buckets = new Map<string, { items: Item[]; failures: string[]; count: number }>()
  for (const inst of config.account.instances) {
    const source = sourceOf(inst, providers)
    if (!source) {
      onError(new Error(`instance ${inst.instance} has no source`))
      continue
    }
    const bucket = buckets.get(source) ?? { items: [], failures: [], count: 0 }
    bucket.count++
    try {
      bucket.items.push(...(await collectInstance(account, source, inst, providers, config)))
    } catch (err) {
      bucket.failures.push(`${inst.instance}: ${(err as Error).message}`)
    }
    buckets.set(source, bucket)
  }
  const out = new Map<string, SourceResult>()
  for (const [source, b] of buckets) {
    const failed = b.failures.length === b.count && b.count > 0
    out.set(source, {
      items: b.items,
      failed,
      note: b.failures.length ? b.failures.join("; ") : null,
    })
  }
  return out
}

// Collects, then seals and publishes one snapshot per source.
export async function runOnce(
  broker: Broker,
  providers: Map<string, Provider>,
  config: ReporterConfig,
  onError: (err: unknown) => void = () => {},
): Promise<void> {
  const account = config.account.account
  log.debug("poll", { account, instances: config.account.instances.length })
  const results = await collectAll(providers, config, onError)
  const sealer = { account, signPrivate: config.signPrivate, hub: config.hub }
  for (const [source, r] of results) {
    log.debug("collected", { source, items: r.items.length, failed: r.failed })
    if (r.failed) log.error("source unavailable", { account, source, note: r.note ?? "" })
    const body = r.failed
      ? { account, source, failed: true, note: r.note }
      : { account, source, items: r.items, note: r.note }
    try {
      await publishStatus(broker, sealer, body)
      log.debug("published", { account, source, items: r.failed ? 0 : r.items.length })
    } catch (err) {
      onError(err)
    }
  }
}

export function startReporter(
  broker: Broker,
  providers: Map<string, Provider>,
  config: ReporterConfig,
  onError?: (err: unknown) => void,
): { stop(): void } {
  void runOnce(broker, providers, config, onError)
  const timer = setInterval(
    () => void runOnce(broker, providers, config, onError),
    config.everyMs ?? 60_000,
  )
  return { stop: () => clearInterval(timer) }
}
