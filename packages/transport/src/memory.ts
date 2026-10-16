import type { Broker, Handler, Subscription } from "./broker.ts"

// Matches a NATS-style subject against a filter with `*` (one token) and `>` (tail).
export function subjectMatches(filter: string, subject: string): boolean {
  const f = filter.split(".")
  const s = subject.split(".")
  for (let i = 0; i < f.length; i++) {
    if (f[i] === ">") return true
    if (i >= s.length) return false
    if (f[i] !== "*" && f[i] !== s[i]) return false
  }
  return f.length === s.length
}

interface Entry {
  filter: string
  handler: Handler
}

export class MemoryBroker implements Broker {
  private subs = new Set<Entry>()

  async publish(subject: string, data: Uint8Array): Promise<void> {
    for (const entry of this.subs) {
      if (subjectMatches(entry.filter, subject)) entry.handler(data, subject)
    }
  }

  async subscribe(subject: string, handler: Handler): Promise<Subscription> {
    const entry: Entry = { filter: subject, handler }
    this.subs.add(entry)
    return { unsubscribe: () => this.subs.delete(entry) }
  }

  async close(): Promise<void> {
    this.subs.clear()
  }
}
