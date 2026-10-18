import { BUILTIN_TOOLS, type RunResult, spawnClaude } from "@periapsis/core"

export { extractJson, spawnClaude, type RunResult, type SpawnOptions } from "@periapsis/core"

// dontAsk refuses any tool not allowed. auto lets a classifier approve tools
// outside the allow list, so the deny list is what keeps connector writes out.
export const PERMISSION_MODES = ["dontAsk", "auto"] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

export function permissionMode(value: unknown): PermissionMode {
  if (value === undefined) return "dontAsk"
  if ((PERMISSION_MODES as readonly unknown[]).includes(value)) return value as PermissionMode
  throw new Error(`permissionMode must be one of ${PERMISSION_MODES.join(", ")}`)
}

export interface RunOptions {
  prompt: string
  tools: string[]
  deny?: string[]
  permissionMode?: PermissionMode
  model?: string
  timeoutMs?: number
}

export function claudeArgs(opts: RunOptions): string[] {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--permission-mode",
    opts.permissionMode ?? "dontAsk",
    "--setting-sources",
    "",
    "--disallowedTools",
    [...BUILTIN_TOOLS, ...(opts.deny ?? [])].join(","),
    "--allowedTools",
    opts.tools.join(","),
  ]
  if (opts.model) args.push("--model", opts.model)
  return args
}

// Runs headless Claude read-only: only the named connector tools, with shell,
// file and web builtins and the connector's write tools denied, so content it
// reads cannot make it act.
export function runClaude(opts: RunOptions): Promise<RunResult> {
  return spawnClaude(claudeArgs(opts), opts.prompt, { timeoutMs: opts.timeoutMs })
}
