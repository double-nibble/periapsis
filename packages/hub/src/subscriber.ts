import {
  type Envelope,
  type RegistryClient,
  type Snapshot,
  createLogger,
  open,
  validateSnapshot,
} from "@periapsis/core"
import type { Broker } from "@periapsis/transport"
import type { Store } from "./store.js"

const log = createLogger("hub.ingest")

export interface Subscriber {
  stop(): void
}

export interface SubscriberDeps {
  broker: Broker
  store: Store
  registry: RegistryClient
  hubBoxPrivate: string
  now?: () => number
  onError?: (err: unknown) => void
}

// Opens each sealed status envelope with the hub's box key, verifies the sender
// against the registry, checks freshness, then reconciles. A bad envelope is
// dropped so one account cannot stall others.
export async function startSubscriber(deps: SubscriberDeps): Promise<Subscriber> {
  const now = deps.now ?? Date.now
  const onError = deps.onError ?? (() => {})
  const seen = new Set<string>()

  const sub = await deps.broker.subscribe("status.>", (data) => {
    let snapshot: Snapshot
    try {
      const env = JSON.parse(new TextDecoder().decode(data)) as Envelope
      log.debug("received", { from: env.from, bytes: data.length })
      const sender = deps.registry.identity(env.from)
      if (!sender) throw new Error(`unknown sender ${env.from}`)
      const payload = open(env, deps.hubBoxPrivate, sender.signPublic, { seen, now: now() })
      snapshot = validateSnapshot(payload, now())
    } catch (err) {
      onError(err)
      return
    }
    if (snapshot.failed) {
      log.info("source unavailable", {
        account: snapshot.account,
        source: snapshot.source,
        note: snapshot.note ?? "",
      })
      try {
        deps.store.sourceFailed(snapshot.account, snapshot.source, snapshot.note ?? "failed", now())
      } catch (err) {
        onError(err)
      }
      return
    }
    log.debug("opened", {
      account: snapshot.account,
      source: snapshot.source,
      items: snapshot.items.length,
    })
    try {
      deps.store.reconcile(snapshot.account, snapshot.source, snapshot.items, now(), snapshot.note)
      log.debug("reconciled", { account: snapshot.account, source: snapshot.source })
    } catch (err) {
      onError(err)
    }
  })
  return { stop: () => sub.unsubscribe() }
}
