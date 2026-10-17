import { type PublicIdentity, createLogger } from "@periapsis/core"
import type { Broker } from "@periapsis/transport"
import { collectSource } from "./collect.js"
import type { AccountConfig, Provider } from "./provider.js"
import { publishStatus } from "./publish.js"

const log = createLogger("reporter")

export interface ReporterConfig {
  account: AccountConfig
  signPrivate: string
  hub: PublicIdentity
  everyMs?: number
}

// Groups the configured instances by provider source, runs each provider over
// its instances, seals the resulting snapshot and publishes it.
export async function runOnce(
  broker: Broker,
  providers: Map<string, Provider>,
  config: ReporterConfig,
  onError: (err: unknown) => void = () => {},
): Promise<void> {
  log.debug("poll", {
    account: config.account.account,
    instances: config.account.instances.length,
  })
  const bySource = new Map<string, typeof config.account.instances>()
  for (const inst of config.account.instances) {
    const provider = providers.get(inst.provider)
    if (!provider) {
      onError(new Error(`no provider for ${inst.provider}`))
      continue
    }
    const list = bySource.get(provider.source) ?? []
    list.push(inst)
    bySource.set(provider.source, list)
  }

  for (const [source, instances] of bySource) {
    const provider = providers.get(instances[0]?.provider ?? "")
    if (!provider) continue
    try {
      const snap = await collectSource(config.account.account, provider, instances)
      log.debug("collected", { source, items: snap.items.length, failed: snap.failed })
      if (snap.failed) {
        log.error("source unavailable", {
          account: config.account.account,
          source,
          note: snap.note ?? "",
        })
      }
      const body = snap.failed
        ? { account: config.account.account, source, failed: true, note: snap.note }
        : { account: config.account.account, source, items: snap.items, note: snap.note }
      await publishStatus(
        broker,
        { account: config.account.account, signPrivate: config.signPrivate, hub: config.hub },
        body,
      )
      log.debug("published", {
        account: config.account.account,
        source,
        items: snap.failed ? 0 : snap.items.length,
      })
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
