import { readFileSync } from "node:fs"
import { RegistryClient, createLogger } from "@periapsis/core"
import { NatsBroker } from "@periapsis/transport"
import type { Provider } from "./provider.js"
import { calendar } from "./providers/calendar.js"
import { github } from "./providers/github.js"
import { type ReporterConfig, startReporter } from "./runtime.js"

const log = createLogger("reporter")

interface FileConfig {
  account: string
  brokerUrl: string
  registryUrl: string
  rootSignPublic: string
  signPrivate: string
  instances: ReporterConfig["account"]["instances"]
  everyMs?: number
  brokerUser?: string
  brokerPass?: string
}

const PROVIDERS = new Map<string, Provider>([
  ["github", github],
  ["gcal", calendar],
])

export async function main(configPath: string): Promise<void> {
  const cfg = JSON.parse(readFileSync(configPath, "utf8")) as FileConfig

  const registry = new RegistryClient({ url: cfg.registryUrl, rootSignPublic: cfg.rootSignPublic })
  await registry.start()
  const hub = registry.identity("hub")
  if (!hub) throw new Error("registry has no hub identity")

  const broker = await NatsBroker.connect({
    servers: cfg.brokerUrl,
    user: cfg.brokerUser,
    pass: cfg.brokerPass,
  })
  log.info("broker connected", { url: cfg.brokerUrl })
  startReporter(
    broker,
    PROVIDERS,
    {
      account: { account: cfg.account, instances: cfg.instances },
      signPrivate: cfg.signPrivate,
      hub,
      everyMs: cfg.everyMs,
    },
    (err) => log.error("reporter error", { err: (err as Error).message }),
  )
  log.info("reporter running", { account: cfg.account })
}

const configPath = process.argv[2]
if (configPath) {
  main(configPath).catch((err) => {
    process.stderr.write(`fatal: ${err.message}\n`)
    process.exit(1)
  })
}
