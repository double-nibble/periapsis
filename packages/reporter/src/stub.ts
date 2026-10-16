import type { PublicIdentity } from "@periapsis/core"
import type { Broker } from "@periapsis/transport"
import { FIXTURES } from "./fixtures.js"
import { publishStatus } from "./publish.js"

export interface StubKeys {
  signPrivateByAccount: Record<string, string>
  hub: PublicIdentity
}

// Publishes sealed fixture snapshots for the fake accounts, once and then on
// an interval, so the hub and UI have fleet data before real providers exist.
export async function runStub(
  broker: Broker,
  keys: StubKeys,
  everyMs = 30_000,
): Promise<{ stop(): void }> {
  const publish = async () => {
    for (const snap of FIXTURES) {
      const signPrivate = keys.signPrivateByAccount[snap.account]
      if (!signPrivate) continue
      await publishStatus(broker, { account: snap.account, signPrivate, hub: keys.hub }, snap)
    }
  }
  await publish()
  const timer = setInterval(publish, everyMs)
  return { stop: () => clearInterval(timer) }
}
