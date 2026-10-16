export type Handler = (data: Uint8Array, subject: string) => void

export interface Subscription {
  unsubscribe(): void
}

export interface Broker {
  publish(subject: string, data: Uint8Array): Promise<void>
  subscribe(subject: string, handler: Handler): Promise<Subscription>
  close(): Promise<void>
}
