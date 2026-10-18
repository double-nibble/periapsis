import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from "node:crypto"
import { sign, verify } from "./signing.js"

export interface IdentityKeys {
  signPublic: string
  signPrivate: string
  boxPublic: string
  boxPrivate: string
}

export interface PublicIdentity {
  signPublic: string
  boxPublic: string
  // The account's NATS nkey (public). The broker authorizes it; the seed never
  // leaves the account's machine.
  nkey?: string
}

export interface Envelope {
  from: string
  nonce: string
  at: number
  ephemeral: string
  ciphertext: string
  iv: string
  tag: string
  signature: string
}

export function generateIdentity(): IdentityKeys {
  const s = generateKeyPairSync("ed25519")
  const b = generateKeyPairSync("x25519")
  return {
    signPublic: s.publicKey.export({ type: "spki", format: "pem" }).toString(),
    signPrivate: s.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    boxPublic: b.publicKey.export({ type: "spki", format: "pem" }).toString(),
    boxPrivate: b.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  }
}

function deriveKey(privatePem: string, publicPem: string): Buffer {
  const shared = diffieHellman({
    privateKey: createPrivateKey(privatePem),
    publicKey: createPublicKey(publicPem),
  })
  return Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), "periapsis-seal", 32))
}

// Sign the payload, then encrypt to the recipient with an ephemeral key (ECIES-style).
export function seal(
  payload: unknown,
  from: string,
  senderSignPrivate: string,
  recipientBoxPublic: string,
): Envelope {
  const nonce = randomBytes(16).toString("base64")
  const at = Date.now()
  const body = { payload, from, nonce, at }
  const signature = sign(body, senderSignPrivate)

  const eph = generateKeyPairSync("x25519")
  const ephPrivate = eph.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  const ephemeral = eph.publicKey.export({ type: "spki", format: "pem" }).toString()
  const key = deriveKey(ephPrivate, recipientBoxPublic)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const plaintext = Buffer.from(JSON.stringify({ payload, signature }), "utf8")
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    from,
    nonce,
    at,
    ephemeral,
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    signature,
  }
}

export class SealError extends Error {}

// Decrypt with the recipient's box key, then verify the sender's signature and freshness.
export function open(
  env: Envelope,
  recipientBoxPrivate: string,
  senderSignPublic: string,
  opts: { maxAgeMs?: number; seen?: Set<string>; now?: number } = {},
): unknown {
  const now = opts.now ?? Date.now()
  const maxAge = opts.maxAgeMs ?? 5 * 60_000
  if (now - env.at > maxAge || env.at - now > maxAge) throw new SealError("stale envelope")
  if (opts.seen) {
    if (opts.seen.has(env.nonce)) throw new SealError("replayed nonce")
    opts.seen.add(env.nonce)
  }
  const key = deriveKey(recipientBoxPrivate, env.ephemeral)
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"))
  decipher.setAuthTag(Buffer.from(env.tag, "base64"))
  let inner: { payload: unknown; signature: string }
  try {
    const plain = Buffer.concat([
      decipher.update(Buffer.from(env.ciphertext, "base64")),
      decipher.final(),
    ])
    inner = JSON.parse(plain.toString("utf8"))
  } catch {
    throw new SealError("decryption failed")
  }
  const body = { payload: inner.payload, from: env.from, nonce: env.nonce, at: env.at }
  if (!verify(body, inner.signature, senderSignPublic)) throw new SealError("bad signature")
  return inner.payload
}
