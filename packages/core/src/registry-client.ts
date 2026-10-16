import { readFile, writeFile } from "node:fs/promises"
import { type Registry, type SignedRegistry, lookup, verifyRegistry } from "./registry.js"
import type { PublicIdentity } from "./sealed.js"

export interface RegistryClientConfig {
  url: string
  rootSignPublic: string
  cachePath?: string
  refreshMs?: number
  fetchImpl?: typeof fetch
}

export class RegistryClient {
  private current: Registry | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private config: RegistryClientConfig) {}

  async start(): Promise<void> {
    await this.refresh().catch(async (err) => {
      const cached = await this.loadCache()
      if (!cached) throw err
      this.current = cached
    })
    const every = this.config.refreshMs ?? 5 * 60_000
    this.timer = setInterval(() => this.refresh().catch(() => {}), every)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  // Strict HTTPS only; verified against the pinned root key before use.
  async refresh(): Promise<void> {
    const url = new URL(this.config.url)
    if (url.protocol !== "https:") throw new Error("registry url must be https")
    const f = this.config.fetchImpl ?? fetch
    const res = await f(this.config.url)
    if (!res.ok) throw new Error(`registry fetch ${res.status}`)
    const doc = (await res.json()) as SignedRegistry
    if (!verifyRegistry(doc, this.config.rootSignPublic))
      throw new Error("registry signature does not verify")
    this.current = doc.registry
    await this.saveCache(doc)
  }

  identity(name: string): PublicIdentity | null {
    return this.current ? lookup(this.current, name) : null
  }

  private async loadCache(): Promise<Registry | null> {
    if (!this.config.cachePath) return null
    try {
      const doc = JSON.parse(await readFile(this.config.cachePath, "utf8")) as SignedRegistry
      return verifyRegistry(doc, this.config.rootSignPublic) ? doc.registry : null
    } catch {
      return null
    }
  }

  private async saveCache(doc: SignedRegistry): Promise<void> {
    if (!this.config.cachePath) return
    try {
      await writeFile(this.config.cachePath, JSON.stringify(doc), { mode: 0o600 })
    } catch {}
  }
}
