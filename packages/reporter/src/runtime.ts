import { type Item, type PublicIdentity, createLogger } from "@periapsis/core"
import type { Broker } from "@periapsis/transport"
import { type AgentRunner, collectAgentInstance } from "./agent/collect.js"
import { toItem } from "./collect.js"
import type { AccountConfig, InstanceConfig, Provider } from "./provider.js"
import { loadProvider } from "./providers/load.js"
import { publishStatus } from "./publish.js"
import { formatInterval, intervalMs } from "./schedule.js"

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

// An instance's latest run. A failed run keeps the items of the last good one.
export interface InstanceState {
  lastRun: number
  items: Item[]
  error: string | null
}

export function instanceIntervals(config: ReporterConfig): Map<string, number> {
  const fallback = config.everyMs ?? 60_000
  return new Map(config.account.instances.map((i) => [i.instance, intervalMs(i, fallback)]))
}

// Runs the instances that are due and returns a snapshot for every source they
// belong to. Each snapshot combines the latest result of all that source's
// instances, so it stays complete however their schedules differ. A source is
// failed only when every one of its instances is failing, so the hub keeps its
// prior items.
export async function collectDue(
  providers: Map<string, Provider>,
  config: ReporterConfig,
  state: Map<string, InstanceState>,
  intervals: Map<string, number>,
  now: number,
  onError: (err: unknown) => void = () => {},
): Promise<Map<string, SourceResult>> {
  const account = config.account.account
  const touched = new Set<string>()
  for (const inst of config.account.instances) {
    const source = sourceOf(inst, providers)
    if (!source) {
      onError(new Error(`instance ${inst.instance} has no source`))
      continue
    }
    const prev = state.get(inst.instance)
    if (prev && now - prev.lastRun < (intervals.get(inst.instance) ?? 0)) continue
    try {
      const items = await collectInstance(account, source, inst, providers, config)
      state.set(inst.instance, { lastRun: now, items, error: null })
    } catch (err) {
      const error = `${inst.instance}: ${(err as Error).message}`
      state.set(inst.instance, { lastRun: now, items: prev?.items ?? [], error })
    }
    touched.add(source)
  }
  const out = new Map<string, SourceResult>()
  for (const source of touched) {
    const insts = config.account.instances.filter((i) => sourceOf(i, providers) === source)
    const states = insts.flatMap((i) => state.get(i.instance) ?? [])
    const errors = states.flatMap((s) => (s.error ? [s.error] : []))
    out.set(source, {
      items: states.flatMap((s) => s.items),
      failed: errors.length === insts.length,
      note: errors.length ? errors.join("; ") : null,
    })
  }
  return out
}

// Collects every instance once.
export function collectAll(
  providers: Map<string, Provider>,
  config: ReporterConfig,
  onError: (err: unknown) => void = () => {},
): Promise<Map<string, SourceResult>> {
  return collectDue(providers, config, new Map(), instanceIntervals(config), Date.now(), onError)
}

// Seals and publishes one snapshot per source.
async function publishResults(
  broker: Broker,
  config: ReporterConfig,
  results: Map<string, SourceResult>,
  onError: (err: unknown) => void,
): Promise<void> {
  const account = config.account.account
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

// Runs each instance on its own schedule. Throws at once if an instance's
// interval is invalid.
export function startReporter(
  broker: Broker,
  providers: Map<string, Provider>,
  config: ReporterConfig,
  onError: (err: unknown) => void = () => {},
): { stop(): void } {
  const intervals = instanceIntervals(config)
  for (const [instance, ms] of intervals)
    log.info("schedule", { instance, every: formatInterval(ms) })
  const state = new Map<string, InstanceState>()
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const results = await collectDue(providers, config, state, intervals, Date.now(), onError)
      await publishResults(broker, config, results, onError)
    } finally {
      running = false
    }
  }
  void tick()
  const every = Math.max(5_000, Math.min(60_000, ...intervals.values()))
  const timer = setInterval(() => void tick(), every)
  return { stop: () => clearInterval(timer) }
}
