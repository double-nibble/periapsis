import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { Provider } from "../provider.js"

const cache = new Map<string, Promise<Provider>>()

function isProvider(x: unknown): x is Provider {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as Provider).source === "string" &&
    typeof (x as Provider).read === "function"
  )
}

async function importProvider(modulePath: string): Promise<Provider> {
  const mod = (await import(pathToFileURL(resolve(modulePath)).href)) as { default?: unknown }
  if (!isProvider(mod.default)) {
    throw new Error(`${modulePath} must default-export a provider (source and read)`)
  }
  return mod.default
}

// Loads and caches a provider module by path. The default export must be a
// Provider. A new provider of an existing type is plugged in this way, with no
// change to periapsis. The path resolves against the reporter's working dir.
export function loadProvider(modulePath: string): Promise<Provider> {
  const cached = cache.get(modulePath)
  if (cached) return cached
  const loaded = importProvider(modulePath)
  cache.set(modulePath, loaded)
  return loaded
}
