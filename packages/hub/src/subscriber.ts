import { STATUS_WILDCARD, type Snapshot, validateSnapshot } from "@periapsis/core"
import type { Broker } from "@periapsis/transport"
import type { Store } from "./store.ts"

export interface Subscriber {
  stop(): void
}

// Subscribes status.> and reconciles each snapshot into the store. A bad
// snapshot from one account is logged and skipped; others are unaffected.
export async function startSubscriber(
  broker: Broker,
  store: Store,
  now: () => number = Date.now,
  onError: (err: unknown) => void = () => {},
): Promise<Subscriber> {
  const sub = await broker.subscribe(STATUS_WILDCARD, (data) => {
    let snapshot: Snapshot
    try {
      snapshot = validateSnapshot(JSON.parse(new TextDecoder().decode(data)), now())
    } catch (err) {
      onError(err)
      return
    }
    // A failed source keeps its items as they were.
    if (snapshot.failed) return
    try {
      store.reconcile(snapshot.account, snapshot.source, snapshot.items, now())
    } catch (err) {
      onError(err)
    }
  })
  return { stop: () => sub.unsubscribe() }
}
