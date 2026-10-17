// Leveled logger. Default level is "error"; set PERIAPSIS_LOG=info or debug to
// raise verbosity. Lines go to stderr so stdout stays usable for data.
export type LogLevel = "error" | "info" | "debug"

const ORDER: Record<LogLevel, number> = { error: 0, info: 1, debug: 2 }

function levelFromEnv(): LogLevel {
  const v = (process.env.PERIAPSIS_LOG ?? "").toLowerCase()
  if (v === "debug") return "debug"
  if (v === "info") return "info"
  return "error"
}

function format(fields?: Record<string, unknown>): string {
  if (!fields) return ""
  let out = ""
  for (const [k, v] of Object.entries(fields)) {
    const s =
      typeof v === "string" || typeof v === "number" || typeof v === "boolean"
        ? String(v)
        : JSON.stringify(v)
    out += ` ${k}=${s}`
  }
  return out
}

export interface Logger {
  error(msg: string, fields?: Record<string, unknown>): void
  info(msg: string, fields?: Record<string, unknown>): void
  debug(msg: string, fields?: Record<string, unknown>): void
}

export function createLogger(scope: string): Logger {
  const threshold = ORDER[levelFromEnv()]
  function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (ORDER[level] > threshold) return
    const ts = new Date().toISOString()
    process.stderr.write(`${ts} ${level.toUpperCase()} ${scope} ${msg}${format(fields)}\n`)
  }
  return {
    error: (m, f) => emit("error", m, f),
    info: (m, f) => emit("info", m, f),
    debug: (m, f) => emit("debug", m, f),
  }
}
