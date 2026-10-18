import type { InstanceConfig } from "./provider.js"

// An agent instance starts a headless Claude every run, so by default it runs
// far less often than a direct one, which uses the reporter's interval.
export const AGENT_DEFAULT_MS = 15 * 60_000
export const MIN_INTERVAL_MS = 10_000

// How often an instance runs, from its `every`: "30s", "5m", "1h", or ms.
export function intervalMs(inst: InstanceConfig, fallbackMs: number): number {
  const every = inst.every
  let ms: number
  if (every === undefined) ms = inst.mode === "agent" ? AGENT_DEFAULT_MS : fallbackMs
  else if (typeof every === "number") ms = every
  else {
    const m = /^(\d+(?:\.\d+)?)\s*([smh])$/.exec(String(every).trim())
    if (!m)
      throw new Error(
        `instance ${inst.instance}: every "${every}" should look like "30s", "5m" or "1h"`,
      )
    const unit = m[2] === "h" ? 3_600_000 : m[2] === "m" ? 60_000 : 1000
    ms = Number(m[1]) * unit
  }
  if (!Number.isFinite(ms) || ms < MIN_INTERVAL_MS)
    throw new Error(`instance ${inst.instance}: every must be at least 10s`)
  return ms
}

export function formatInterval(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`
  if (ms % 60_000 === 0) return `${ms / 60_000}m`
  return `${Math.round(ms / 1000)}s`
}
