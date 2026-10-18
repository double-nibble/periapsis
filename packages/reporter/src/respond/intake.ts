import {
  type Envelope,
  type PublicIdentity,
  commandSubject,
  createLogger,
  open,
  validateCommand,
} from "@periapsis/core"
import type { Broker } from "@periapsis/transport"
import type { Responder } from "./responder.js"

const log = createLogger("reporter.command")

export interface IntakeDeps {
  broker: Broker
  account: string
  boxPrivate: string
  hub: PublicIdentity
  responder: Responder
  onError?: (err: unknown) => void
}

// Takes commands for this account that the hub sealed to it and signed, fresh
// and not replayed, and hands each to the responder.
export async function startIntake(deps: IntakeDeps): Promise<{ stop(): void }> {
  const seen = new Set<string>()
  const onError = deps.onError ?? (() => {})
  const sub = await deps.broker.subscribe(commandSubject(deps.account), (data) => {
    try {
      const env = JSON.parse(new TextDecoder().decode(data)) as Envelope
      if (env.from !== "hub") throw new Error(`command from ${env.from}, not the hub`)
      const cmd = validateCommand(open(env, deps.boxPrivate, deps.hub.signPublic, { seen }))
      if (cmd.account !== deps.account) throw new Error(`command for ${cmd.account}`)
      log.info("respond", { id: cmd.id, item: cmd.item.key })
      deps.responder.handle(cmd).catch(onError)
    } catch (err) {
      onError(err)
    }
  })
  return { stop: () => sub.unsubscribe() }
}
