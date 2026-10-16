import { statusSubject } from "@periapsis/core"
import type { Broker } from "@periapsis/transport"
import { FIXTURES } from "./fixtures.js"

// Publishes the fixtures once, then on an interval, so the hub and UI
// have fleet data before real providers exist.
export async function runStub(broker: Broker, everyMs = 30_000): Promise<{ stop(): void }> {
  const publish = async () => {
    for (const snap of FIXTURES) {
      const data = new TextEncoder().encode(JSON.stringify(snap))
      await broker.publish(statusSubject(snap.account), data)
    }
  }
  await publish()
  const timer = setInterval(publish, everyMs)
  return { stop: () => clearInterval(timer) }
}
