import { type PublicIdentity, seal, statusSubject } from "@periapsis/core"
import type { Broker } from "@periapsis/transport"

export interface StatusSealer {
  account: string
  signPrivate: string
  hub: PublicIdentity
}

// Seals a snapshot to the hub and publishes it to this account's status subject.
export async function publishStatus(
  broker: Broker,
  sealer: StatusSealer,
  snapshot: object,
): Promise<void> {
  const env = seal(snapshot, sealer.account, sealer.signPrivate, sealer.hub.boxPublic)
  const data = new TextEncoder().encode(JSON.stringify(env))
  await broker.publish(statusSubject(sealer.account), data)
}
