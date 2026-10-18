import { randomUUID } from "node:crypto"
import {
  type RegistryClient,
  commandSubject,
  createLogger,
  seal,
  validateCommand,
} from "@periapsis/core"
import type { Broker } from "@periapsis/transport"
import type { Row } from "./store.js"

const log = createLogger("hub.command")

export type Respond = (row: Row, prompt: string) => Promise<string>

// Seals a respond command to the item's account with the hub's signing key, so
// its reporter can check the hub sent it, and publishes it to that account.
export function commander(broker: Broker, registry: RegistryClient, signPrivate: string): Respond {
  return async (row, prompt) => {
    const to = registry.identity(row.account)
    if (!to) throw new Error(`${row.account} is not in the registry`)
    let meta: Record<string, string> = {}
    try {
      meta = JSON.parse(row.meta)
    } catch {}
    const command = validateCommand({
      id: randomUUID(),
      type: "respond",
      account: row.account,
      prompt,
      item: {
        source: row.source,
        key: row.key,
        kind: row.kind,
        title: row.title,
        detail: row.detail,
        body: row.body,
        url: row.url,
        meta,
      },
    })
    const env = seal(command, "hub", signPrivate, to.boxPublic)
    await broker.publish(commandSubject(row.account), new TextEncoder().encode(JSON.stringify(env)))
    log.info("respond sent", {
      account: row.account,
      source: row.source,
      key: row.key,
      id: command.id,
    })
    return command.id
  }
}
