import { readFileSync } from "node:fs"
import { RegistryClient } from "@periapsis/core"
import { NatsBroker } from "@periapsis/transport"
import type { Provider } from "./provider.js"
import { github } from "./providers/github.js"
import { type ReporterConfig, startReporter } from "./runtime.js"

interface FileConfig {
  account: string
  brokerUrl: string
  registryUrl: string
  rootSignPublic: string
  signPrivate: string
  instances: ReporterConfig["account"]["instances"]
  everyMs?: number
}

const PROVIDERS = new Map<string, Provider>([["github", github]])

export async function main(configPath: string): Promise<void> {
  const cfg = JSON.parse(readFileSync(configPath, "utf8")) as FileConfig

  const registry = new RegistryClient({ url: cfg.registryUrl, rootSignPublic: cfg.rootSignPublic })
  await registry.start()
  const hub = registry.identity("hub")
  if (!hub) throw new Error("registry has no hub identity")

  const broker = await NatsBroker.connect({ servers: cfg.brokerUrl })
  startReporter(
    broker,
    PROVIDERS,
    {
      account: { account: cfg.account, instances: cfg.instances },
      signPrivate: cfg.signPrivate,
      hub,
      everyMs: cfg.everyMs,
    },
    (err) => process.stderr.write(`reporter error: ${(err as Error).message}\n`),
  )
  process.stderr.write(`periapsis reporter running for ${cfg.account}\n`)
}

const configPath = process.argv[2]
if (configPath) {
  main(configPath).catch((err) => {
    process.stderr.write(`fatal: ${err.message}\n`)
    process.exit(1)
  })
}
