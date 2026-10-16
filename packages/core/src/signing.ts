import {
  type KeyObject,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
} from "node:crypto"

export interface Keypair {
  privateKey: string
  publicKey: string
}

export function generateKeypair(): Keypair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  }
}

// Stable serialization: object keys sorted, so a signature is reproducible.
function canonical(payload: unknown): Buffer {
  return Buffer.from(stringify(payload), "utf8")
}

function stringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stringify).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stringify(v)}`)
  return `{${entries.join(",")}}`
}

function privateFrom(key: string): KeyObject {
  return createPrivateKey(key)
}

function publicFrom(key: string): KeyObject {
  return createPublicKey(key)
}

export function sign(payload: unknown, privateKey: string): string {
  return nodeSign(null, canonical(payload), privateFrom(privateKey)).toString("base64")
}

export function verify(payload: unknown, signature: string, publicKey: string): boolean {
  try {
    return nodeVerify(
      null,
      canonical(payload),
      publicFrom(publicKey),
      Buffer.from(signature, "base64"),
    )
  } catch {
    return false
  }
}
