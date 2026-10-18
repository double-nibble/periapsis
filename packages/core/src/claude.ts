import { spawn } from "node:child_process"

// Claude Code's built-in tools: shell, files, web and agents. Denying them
// leaves headless Claude only the tools a caller allows.
export const BUILTIN_TOOLS = [
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

export interface RunResult {
  result: string
  isError: boolean
  costUsd: number | null
  turns: number | null
  sessionId?: string | null
}

interface Envelope {
  result?: string
  is_error?: boolean
  total_cost_usd?: number
  num_turns?: number
  session_id?: string
}

export interface SpawnOptions {
  cwd?: string
  timeoutMs?: number
}

// Runs `claude` with the given arguments and returns its JSON envelope. The
// prompt goes on stdin because argv is visible to other local users.
export function spawnClaude(
  args: string[],
  prompt: string,
  opts: SpawnOptions = {},
): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    })
    let out = ""
    child.stdin.end(prompt)
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
        sessionId: env.session_id ?? null,
      })
    })
  })
}
