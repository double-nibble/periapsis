import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { RegistryClient, createLogger } from "@periapsis/core"
import { NatsBroker } from "@periapsis/transport"
import { loadInstances } from "./instances.js"
import { PROVIDERS } from "./providers/all.js"
import { publishStatus } from "./publish.js"
import { startIntake } from "./respond/intake.js"
import { type RespondConfig, Responder } from "./respond/responder.js"
import { type ReporterConfig, startReporter } from "./runtime.js"

const log = createLogger("reporter")

interface FileConfig {
  account: string
  brokerUrl: string
  registryUrl: string
  rootSignPublic: string
  signPrivate: string
  // Opens commands the hub seals to this account.
  boxPrivate?: string
  // Present when this machine runs the operator's responses.
  respond?: RespondConfig
  // Inline, or a path (relative to this file) read on every start.
  instances?: ReporterConfig["account"]["instances"] | string
  everyMs?: number
  model?: string
  brokerUser?: string
  brokerPass?: string
  // An nkey seed (SU...). Preferred over brokerUser/brokerPass.
  natsSeed?: string
}

export async function main(configPath: string): Promise<void> {
  const cfg = JSON.parse(readFileSync(configPath, "utf8")) as FileConfig
  const { instances, from } = loadInstances(cfg.instances, configPath)
  log.info("instances loaded", {
    from,
    count: instances.length,
    names: instances.map((i) => i.instance).join(",") || "(none)",
  })

  const registry = new RegistryClient({ url: cfg.registryUrl, rootSignPublic: cfg.rootSignPublic })
  await registry.start()
  const hub = registry.identity("hub")
  if (!hub) throw new Error("registry has no hub identity")

  const broker = await NatsBroker.connect({
    servers: cfg.brokerUrl,
    nkeySeed: cfg.natsSeed,
    user: cfg.brokerUser,
    pass: cfg.brokerPass,
  })
  log.info("broker connected", { url: cfg.brokerUrl })
  startReporter(
    broker,
    PROVIDERS,
    {
      account: { account: cfg.account, instances },
      signPrivate: cfg.signPrivate,
      hub,
      everyMs: cfg.everyMs,
      model: cfg.model,
    },
    (err) => log.error("reporter error", { err: (err as Error).message }),
  )
  if (cfg.boxPrivate) {
    const sealer = { account: cfg.account, signPrivate: cfg.signPrivate, hub }
    const responder = new Responder(
      cfg.account,
      cfg.respond,
      resolve(dirname(configPath), "respond-state.json"),
      (items) => publishStatus(broker, sealer, { account: cfg.account, source: "tasks", items }),
    )
    await startIntake({
      broker,
      account: cfg.account,
      boxPrivate: cfg.boxPrivate,
      hub,
      responder,
      onError: (err) => log.error("command refused", { err: (err as Error).message }),
    })
    await responder.announce()
    log.info("responses", { enabled: Boolean(cfg.respond), cwd: cfg.respond?.cwd ?? "~" })
  } else {
    log.info("responses", { enabled: false, reason: "config has no boxPrivate" })
  }
  log.info("reporter running", { account: cfg.account })
}

const configPath = process.argv[2]
if (configPath) {
  main(configPath).catch((err) => {
    process.stderr.write(
      `fatal: ${err instanceof Error && err.message ? err.message : String(err)}\n`,
    )
    process.exit(1)
  })
}
