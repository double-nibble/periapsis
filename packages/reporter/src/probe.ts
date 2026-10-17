import { readFileSync } from "node:fs"
import { createLogger } from "@periapsis/core"
import type { InstanceConfig } from "./provider.js"
import { PROVIDERS } from "./providers/all.js"
import { collectAll } from "./runtime.js"

const log = createLogger("probe")

interface ProbeConfig {
  account?: string
  model?: string
  instances: InstanceConfig[]
}

// Runs the configured instances once and prints the body each source would seal
// and publish. No broker, no keys. Use PERIAPSIS_LOG=debug to see collection logs.
export async function main(configPath: string): Promise<void> {
  const cfg = JSON.parse(readFileSync(configPath, "utf8")) as ProbeConfig
  const account = cfg.account ?? "probe"
  const results = await collectAll(
    PROVIDERS,
    {
      account: { account, instances: cfg.instances ?? [] },
      signPrivate: "",
      hub: { signPublic: "", boxPublic: "" },
      model: cfg.model,
    },
    (err) => log.error("probe error", { err: (err as Error).message }),
  )
  const out: Record<string, unknown> = {}
  for (const [source, r] of results) {
    out[source] = r.failed
      ? { account, source, failed: true, note: r.note }
      : { account, source, items: r.items, note: r.note }
  }
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
}

const configPath = process.argv[2]
if (configPath) {
  main(configPath).catch((err) => {
    process.stderr.write(`fatal: ${err.message}\n`)
    process.exit(1)
  })
}
