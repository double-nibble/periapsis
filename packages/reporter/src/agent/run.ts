import { spawn } from "node:child_process"

const BLOCKED_BUILTINS = [
  "Bash",
  "BashOutput",
  "KillShell",
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "Agent",
  "Task",
  "Read",
  "Glob",
  "Grep",
  "Skill",
  "SlashCommand",
  "TodoWrite",
  "ExitPlanMode",
]

// The last fenced ```json block, or the outermost braces, from Claude's reply.
export function extractJson(text: string): unknown {
  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].at(-1)?.[1]
  const raw = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
  return JSON.parse(raw)
}

export interface RunOptions {
  prompt: string
  tools: string[]
  model?: string
  timeoutMs?: number
}

export interface RunResult {
  result: string
  isError: boolean
  costUsd: number | null
  turns: number | null
}

interface Envelope {
  result?: string
  is_error?: boolean
  total_cost_usd?: number
  num_turns?: number
}

// Runs headless Claude read-only: only the named connector tools, with shell,
// file and web builtins denied, so content it reads cannot make it act. The
// prompt goes on stdin because argv is visible to other local users.
export function runClaude(opts: RunOptions): Promise<RunResult> {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--permission-mode",
    "dontAsk",
    "--setting-sources",
    "",
    "--disallowedTools",
    BLOCKED_BUILTINS.join(","),
    "--allowedTools",
    opts.tools.join(","),
  ]
  if (opts.model) args.push("--model", opts.model)
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"], detached: true })
    let out = ""
    child.stdin.end(opts.prompt)
    child.stdout.on("data", (d) => {
      out += d
    })
    const kill = (sig: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, sig)
      } catch {}
    }
    const timer = setTimeout(
      () => {
        kill("SIGTERM")
        setTimeout(() => kill("SIGKILL"), 10_000).unref()
      },
      opts.timeoutMs ?? 15 * 60_000,
    )
    child.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on("close", () => {
      clearTimeout(timer)
      let env: Envelope
      try {
        env = JSON.parse(out) as Envelope
      } catch {
        reject(new Error(`claude produced no JSON envelope: ${out.slice(-200)}`))
        return
      }
      resolve({
        result: String(env.result ?? ""),
        isError: env.is_error === true,
        costUsd: env.total_cost_usd ?? null,
        turns: env.num_turns ?? null,
      })
    })
  })
}
