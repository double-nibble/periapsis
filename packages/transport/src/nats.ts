import { type NatsConnection, connect } from "nats.ws"
import type { Broker, Handler, Subscription } from "./broker.js"

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

  static async connect(config: NatsConfig): Promise<NatsBroker> {
    const nc = await connect({
      servers: config.servers,
      token: config.token,
      user: config.user,
      pass: config.pass,
    })
    return new NatsBroker(nc)
  }

  async publish(subject: string, data: Uint8Array): Promise<void> {
    this.nc.publish(subject, data)
    await this.nc.flush()
  }

  async subscribe(subject: string, handler: Handler): Promise<Subscription> {
    const sub = this.nc.subscribe(subject)
    ;(async () => {
      for await (const msg of sub) handler(msg.data, msg.subject)
    })()
    return { unsubscribe: () => sub.unsubscribe() }
  }

  async close(): Promise<void> {
    await this.nc.drain()
  }
}
