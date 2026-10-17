import { mkdirSync, readFileSync } from "node:fs"
import { RegistryClient } from "@periapsis/core"
import { NatsBroker } from "@periapsis/transport"
import { startServer } from "./server.js"
import { openStore } from "./store.js"
import { startSubscriber } from "./subscriber.js"

interface HubFileConfig {
  brokerUrl: string
  registryUrl: string
  rootSignPublic: string
  boxPrivate: string
  port?: number
  dataDir?: string
}

export async function main(configPath: string): Promise<void> {
  const cfg = JSON.parse(readFileSync(configPath, "utf8")) as HubFileConfig

  const registry = new RegistryClient({ url: cfg.registryUrl, rootSignPublic: cfg.rootSignPublic })
  await registry.start()

  if (cfg.dataDir) mkdirSync(cfg.dataDir, { recursive: true })
  const store = openStore(cfg.dataDir ? `${cfg.dataDir}/hub.db` : ":memory:")
  const broker = await NatsBroker.connect({ servers: cfg.brokerUrl })
  const port = cfg.port ?? 4747
  const server = startServer(store, port)

  await startSubscriber({
    broker,
    store,
    registry,
    hubBoxPrivate: cfg.boxPrivate,
    onError: (err) => process.stderr.write(`ingest error: ${(err as Error).message}\n`),
  })

  // Push model updates to connected dashboards on a short interval.
  setInterval(() => server.push(), 2_000).unref?.()

  process.stderr.write(`periapsis hub running on http://127.0.0.1:${port}\n`)
}

const configPath = process.argv[2]
if (configPath) {
  main(configPath).catch((err) => {
    process.stderr.write(`fatal: ${err.message}\n`)
    process.exit(1)
  })
}
