import { readFile } from "node:fs/promises"
import { homedir } from "node:os"

// A credential from an instance's params: the value itself under `name`, a
// file holding it under `<name>File`, or an environment variable under
// `<name>Env`, so instances.json need not contain the secret.
export async function secret(params: Record<string, unknown>, name: string): Promise<string> {
  const direct = params[name]
  if (typeof direct === "string" && direct) return direct
  const file = params[`${name}File`]
  if (typeof file === "string" && file) {
    const path = file.replace(/^~(?=\/|$)/, homedir())
    const value = (await readFile(path, "utf8")).trim()
    if (value) return value
    throw new Error(`${path} is empty`)
  }
  const env = params[`${name}Env`]
  if (typeof env === "string" && env) {
    const value = process.env[env]
    if (value) return value
    throw new Error(`environment variable ${env} is not set`)
  }
  throw new Error(`needs ${name}, ${name}File or ${name}Env in params`)
}

export function basicAuth(user: string, token: string): string {
  return `Basic ${Buffer.from(`${user}:${token}`).toString("base64")}`
}

// Fetches JSON, retrying a 429 or 5xx twice with a short backoff.
export async function fetchJson<T>(url: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...(init.headers ?? {}) },
  })
  if ((res.status === 429 || res.status >= 500) && attempt < 2) {
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    return fetchJson(url, init, attempt + 1)
  }
  if (!res.ok) {
    const host = new URL(url).host
    throw new Error(`${host} ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  return (await res.json()) as T
}
