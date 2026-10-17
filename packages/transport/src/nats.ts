import { createLogger } from "@periapsis/core"
import { type NatsConnection, connect } from "nats.ws"
import type { Broker, Handler, Subscription } from "./broker.js"

const log = createLogger("nats")

export interface NatsConfig {
  // One or more ws:// or wss:// URLs. Production uses wss:// so broker
  // traffic is an ordinary secure WebSocket on 443.
  servers: string | string[]
  token?: string
  user?: string
  pass?: string
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
    const nc = await connect({
      servers: config.servers,
      token: config.token,
      user: config.user,
      pass: config.pass,
    })
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
