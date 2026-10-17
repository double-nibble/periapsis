import { mkdirSync, readFileSync } from "node:fs"
import { RegistryClient, createLogger } from "@periapsis/core"
import { NatsBroker } from "@periapsis/transport"
import { startServer } from "./server.js"
import { openStore } from "./store.js"
import { startSubscriber } from "./subscriber.js"

const log = createLogger("hub")

interface HubFileConfig {
  brokerUrl: string
  registryUrl: string
  rootSignPublic: string
  boxPrivate: string
  port?: number
  dataDir?: string
  brokerUser?: string
  brokerPass?: string
  natsSeed?: string
}

export async function main(configPath: string): Promise<void> {
  const cfg = JSON.parse(readFileSync(configPath, "utf8")) as HubFileConfig

  const registry = new RegistryClient({ url: cfg.registryUrl, rootSignPublic: cfg.rootSignPublic })
  await registry.start()
  log.info("registry loaded", { url: cfg.registryUrl })

  if (cfg.dataDir) mkdirSync(cfg.dataDir, { recursive: true })
  const store = openStore(cfg.dataDir ? `${cfg.dataDir}/hub.db` : ":memory:")
  const broker = await NatsBroker.connect({
    servers: cfg.brokerUrl,
    nkeySeed: cfg.natsSeed,
    user: cfg.brokerUser,
    pass: cfg.brokerPass,
  })
  log.info("broker connected", { url: cfg.brokerUrl })
  const port = cfg.port ?? 4747
  const server = startServer(store, port)

  await startSubscriber({
    broker,
    store,
    registry,
    hubBoxPrivate: cfg.boxPrivate,
    onError: (err) => log.error("ingest error", { err: (err as Error).message }),
  })

  // Push model updates to connected dashboards on a short interval.
  setInterval(() => server.push(), 2_000).unref?.()

  log.info("hub running", { url: `http://127.0.0.1:${port}` })
}

const configPath = process.argv[2]
if (configPath) {
  main(configPath).catch((err) => {
    process.stderr.write(`fatal: ${err.message}\n`)
    process.exit(1)
  })
}
