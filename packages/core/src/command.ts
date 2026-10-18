import { isId, safeLink } from "./ids.js"
import { SchemaError, str } from "./schema.js"

// The item a command is about, as the hub shows it.
export interface CommandItem {
  source: string
  key: string
  kind: string
  title: string
  detail: string | null
  body: string | null
  url: string | null
  meta: Record<string, string>
}

// A request from the hub to one account's reporter: run the operator's prompt
// about an item on that machine.
export interface Command {
  id: string
  type: "respond"
  account: string
  prompt: string
  item: CommandItem
}

const COMMAND_ID = /^[a-z0-9][a-z0-9-]{7,63}$/
const MAX_PROMPT = 8_000

function meta(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 30))
    if (typeof v === "string") out[k.slice(0, 60)] = v.slice(0, 300)
  return out
}

export function validateCommand(body: unknown): Command {
  if (!body || typeof body !== "object") throw new SchemaError("command must be an object")
  const b = body as Record<string, unknown>
  if (typeof b.id !== "string" || !COMMAND_ID.test(b.id)) throw new SchemaError("bad command id")
  if (b.type !== "respond") throw new SchemaError(`unknown command type ${String(b.type)}`)
  if (!isId(b.account)) throw new SchemaError("bad command account")
  if (typeof b.prompt === "string" && b.prompt.length > MAX_PROMPT)
    throw new SchemaError(`prompt is over ${MAX_PROMPT} characters`)
  const prompt = str(b.prompt, MAX_PROMPT, "prompt", true) as string
  const it = b.item as Record<string, unknown> | undefined
  if (!it || typeof it !== "object") throw new SchemaError("command item is required")
  if (!isId(it.source)) throw new SchemaError("bad item source")
  return {
    id: b.id,
    type: "respond",
    account: b.account,
    prompt,
    item: {
      source: it.source,
      key: str(it.key, 300, "item.key", true) as string,
      kind: str(it.kind, 40, "item.kind") ?? it.source,
      title: str(it.title, 300, "item.title", true) as string,
      detail: str(it.detail, 600, "item.detail"),
      body: str(it.body, 16_000, "item.body"),
      url: safeLink(it.url),
      meta: meta(it.meta),
    },
  }
}
