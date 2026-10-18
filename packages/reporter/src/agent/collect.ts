import { type Item, isKind, safeLink } from "@periapsis/core"
import type { InstanceConfig } from "../provider.js"
import { monthWindow } from "../providers/window.js"
import { type RunOptions, type RunResult, extractJson, permissionMode, runClaude } from "./run.js"
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
  body?: unknown
  kind?: unknown
  meta?: unknown
}

// Extra facts a source reports, as short strings; the reporter's own keys win.
function extraMeta(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 20))
    if (typeof v === "string" || typeof v === "number")
      out[k.slice(0, 40)] = String(v).slice(0, 300)
  return out
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
    kind: isKind(raw.kind) ? raw.kind : kind,
    priority,
    title: String(raw.title ?? ""),
    detail: raw.detail != null ? String(raw.detail) : null,
    body: typeof raw.body === "string" ? raw.body.slice(0, 16_000) : null,
    url: safeLink(raw.url),
    group: raw.group != null ? String(raw.group) : null,
    fingerprint: String(raw.fingerprint ?? ""),
    meta: {
      ...extraMeta(raw.meta),
      instance,
      ...(at ? { at } : {}),
      ...(end ? { end } : {}),
      ...(raw.allDay === true ? { allDay: "true" } : {}),
    },
  }
}

// The instance's own settings for the source, such as which pages to watch;
// the inline source definition is already in the prompt.
function settings(params: Record<string, unknown> = {}): Record<string, unknown> {
  const { tools, instructions, deny, kind, ...rest } = params
  return rest
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
  const mode = permissionMode(instance.permissionMode)
  if (mode === "auto" && spec.deny.length === 0)
    throw new Error(`auto mode needs the ${source} source's write tools in params.deny`)
  const now = new Date()
  const { start, end } = monthWindow(now)
  const context = {
    account,
    instance: instance.instance,
    now: now.toISOString(),
    window: { start: start.toISOString(), end: end.toISOString() },
    params: settings(instance.params),
  }
  const { prompt, tools, deny } = buildPrompt(spec, context)
  const res = await run({ prompt, tools, deny, permissionMode: mode, model })
  if (res.isError) throw new Error(res.result.slice(0, 200) || "agent error")
  const parsed = extractJson(res.result) as { items?: unknown[]; failed?: boolean; note?: string }
  if (parsed.failed) throw new Error(parsed.note ?? "agent reported failure")
  if (!Array.isArray(parsed.items)) throw new Error("agent reply had no items array")
  return parsed.items.map((it) =>
    toItem(it as AgentItem, account, source, instance.instance, spec.kind),
  )
}
