export const KINDS = [
  "task",
  "ticket",
  "pr",
  "project",
  "doc",
  "message",
  "email",
  "calendar",
] as const

export type Kind = (typeof KINDS)[number]

const KIND_SET: ReadonlySet<string> = new Set(KINDS)

export function isKind(value: unknown): value is Kind {
  return typeof value === "string" && KIND_SET.has(value)
}
