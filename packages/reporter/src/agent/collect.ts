import { type Item, safeLink } from "@periapsis/core"
import type { InstanceConfig } from "../provider.js"
import { monthWindow } from "../providers/window.js"
import { type RunOptions, type RunResult, extractJson, runClaude } from "./run.js"
import { buildPrompt, resolveSource } from "./sources.js"

export type AgentRunner = (opts: RunOptions) => Promise<RunResult>

interface AgentItem {
  key?: unknown
  title?: unknown
  detail?: unknown
  url?: unknown
  group?: unknown
  priority?: unknown
  fingerprint?: unknown
  at?: unknown
  end?: unknown
  allDay?: unknown
}

function toItem(
  raw: AgentItem,
  account: string,
  source: string,
  instance: string,
  kind: Item["kind"],
): Item {
  const priority = raw.priority === 1 || raw.priority === 3 ? raw.priority : 2
  const at = typeof raw.at === "string" ? raw.at : undefined
  const end = typeof raw.end === "string" ? raw.end : undefined
  return {
    key: `${account}:${source}:${instance}/${String(raw.key ?? "")}`,
    kind,
    priority,
    title: String(raw.title ?? ""),
    detail: raw.detail != null ? String(raw.detail) : null,
    url: safeLink(raw.url),
    group: raw.group != null ? String(raw.group) : null,
    fingerprint: String(raw.fingerprint ?? ""),
    meta: {
      instance,
      ...(at ? { at } : {}),
      ...(end ? { end } : {}),
      ...(raw.allDay === true ? { allDay: "true" } : {}),
    },
  }
}

// Runs one agent-backed instance: headless Claude reads the source's connectors
// and returns items. Throws when it reports failure or omits the items array,
// so the caller records the instance as failed.
export async function collectAgentInstance(
  account: string,
  source: string,
  instance: InstanceConfig,
  run: AgentRunner = runClaude,
  model?: string,
): Promise<Item[]> {
  const spec = resolveSource(source, instance.params)
  const now = new Date()
  const { start, end } = monthWindow(now)
  const context = {
    account,
    instance: instance.instance,
    now: now.toISOString(),
    window: { start: start.toISOString(), end: end.toISOString() },
  }
  const { prompt, tools } = buildPrompt(spec, context)
  const res = await run({ prompt, tools, model })
  if (res.isError) throw new Error(res.result.slice(0, 200) || "agent error")
  const parsed = extractJson(res.result) as { items?: unknown[]; failed?: boolean; note?: string }
  if (parsed.failed) throw new Error(parsed.note ?? "agent reported failure")
  if (!Array.isArray(parsed.items)) throw new Error("agent reply had no items array")
  return parsed.items.map((it) =>
    toItem(it as AgentItem, account, source, instance.instance, spec.kind),
  )
}
