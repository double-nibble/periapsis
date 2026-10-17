import { createLogger } from "@periapsis/core"
import { type ConnectionOptions, type NatsConnection, connect, nkeyAuthenticator } from "nats.ws"
import type { Broker, Handler, Subscription } from "./broker.js"

const log = createLogger("nats")

export interface NatsConfig {
  // One or more ws:// or wss:// URLs. Production uses wss:// so broker
  // traffic is an ordinary secure WebSocket on 443.
  servers: string | string[]
  token?: string
  user?: string
  pass?: string
  // An nkey seed (SU...). When set, the connection authenticates by proving
  // possession of the seed, and no password is sent.
  nkeySeed?: string
}

// Maps a NatsConfig to nats.ws connection options. An nkey seed takes
// precedence over user/password, so possession of the seed is the only
// credential on the wire.
export function connectOptions(config: NatsConfig): ConnectionOptions {
  const opts: ConnectionOptions = { servers: config.servers }
  if (config.nkeySeed) {
    opts.authenticator = nkeyAuthenticator(new TextEncoder().encode(config.nkeySeed))
  } else {
    opts.token = config.token
    opts.user = config.user
    opts.pass = config.pass
  }
  return opts
}

export class NatsBroker implements Broker {
  private nc: NatsConnection

  private constructor(nc: NatsConnection) {
    this.nc = nc
  }

  get info(): NatsConnection["info"] {
    return this.nc.info
  }

  static async connect(config: NatsConfig): Promise<NatsBroker> {
    const nc = await connect(connectOptions(config))
    log.info("connected", { servers: config.servers })
    return new NatsBroker(nc)
  }

  async publish(subject: string, data: Uint8Array): Promise<void> {
    log.debug("publish", { subject, bytes: data.length })
    this.nc.publish(subject, data)
    await this.nc.flush()
  }

  async subscribe(subject: string, handler: Handler): Promise<Subscription> {
    log.debug("subscribe", { subject })
    const sub = this.nc.subscribe(subject)
    ;(async () => {
      for await (const msg of sub) {
        log.debug("message", { subject: msg.subject, bytes: msg.data.length })
        handler(msg.data, msg.subject)
      }
    })()
    return { unsubscribe: () => sub.unsubscribe() }
  }

  async close(): Promise<void> {
    log.debug("draining")
    await this.nc.drain()
  }
}
