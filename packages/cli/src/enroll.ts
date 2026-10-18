import {
  type PublicIdentity,
  type Registry,
  type SignedRegistry,
  keygen,
  signRegistry,
  verifyRegistry,
} from "@periapsis/core"
import { createUser, fromSeed } from "nkeys.js"

export interface NatsUser {
  seed: string
  publicKey: string
}

// A fresh NATS user nkey. The seed is the private credential (stays on the
// reporter); the public key is what the broker authorizes.
export function newNatsUser(): NatsUser {
  const kp = createUser()
  return { seed: new TextDecoder().decode(kp.getSeed()), publicKey: kp.getPublicKey() }
}

export function natsPublicFromSeed(seed: string): string {
  return fromSeed(new TextEncoder().encode(seed)).getPublicKey()
}

// What a reporter prints for the operator to authorize: only public values.
export interface EnrollmentBlob {
  account: string
  identity: PublicIdentity
  nkey: string
}

// What stays on the reporter: the private keys and the nkey seed.
export interface ReporterSecrets {
  account: string
  signPrivate: string
  boxPrivate: string
  natsSeed: string
}

// Generate a reporter's own identity and nkey. The secrets never leave the
// machine; the blob carries only public keys for the operator to authorize.
export function buildEnrollment(account: string): {
  secrets: ReporterSecrets
  blob: EnrollmentBlob
} {
  const { identity, publicIdentity } = keygen()
  const user = newNatsUser()
  return {
    secrets: {
      account,
      signPrivate: identity.signPrivate,
      boxPrivate: identity.boxPrivate,
      natsSeed: user.seed,
    },
    blob: { account, identity: publicIdentity, nkey: user.publicKey },
  }
}

export type AccountsMap = Record<string, { nkey: string }>

export interface RootKeys {
  signPublic: string
  signPrivate: string
}

// Authorize an enrollment against the published registry: verify it under the
// root key, record the identity with its nkey, and re-sign. The signed registry
// is the fleet's only record, so enrolling needs nothing but it and the root key.
// Returns whether an existing identity for the account was replaced.
export function enrollSigned(
  current: SignedRegistry | null,
  blob: EnrollmentBlob,
  root: RootKeys,
): { signed: SignedRegistry; replaced: boolean } {
  if (current && !verifyRegistry(current, root.signPublic))
    throw new Error("the current registry does not verify under this root key")
  const registry: Registry = current
    ? structuredClone(current.registry)
    : { identities: {}, signedAt: 0 }
  const replaced = blob.account in registry.identities
  registry.identities[blob.account] = { ...blob.identity, nkey: blob.nkey }
  registry.signedAt = Date.now()
  return { signed: signRegistry(registry, root.signPrivate), replaced }
}

// Every enrolled account's nkey, read from the registry.
export function accountsFromRegistry(registry: Registry): AccountsMap {
  const out: AccountsMap = {}
  for (const [name, id] of Object.entries(registry.identities)) {
    if (id.nkey) out[name] = { nkey: id.nkey }
  }
  return out
}

// The NATS permissions for an account: the hub sees the whole fleet; a reporter
// is locked to its own status subject and command inbox.
export function permissionsFor(name: string): string {
  return name === "hub"
    ? '{ publish: ["commands.>"], subscribe: ["status.>", "_INBOX.>"] }'
    : `{ publish: ["status.${name}"], subscribe: ["commands.${name}", "_INBOX.>"] }`
}

// A NATS authorization block that authenticates each account by its nkey. No
// passwords: possession of the matching seed is the only credential.
export function accountsConf(accounts: AccountsMap): string {
  const users = Object.entries(accounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { nkey }]) => `    { nkey: "${nkey}", permissions: ${permissionsFor(name)} }`)
  return `authorization {\n  users = [\n${users.join("\n")}\n  ]\n}\n`
}

// The enrollment as one opaque token (base64url of its JSON): no quotes,
// backslashes or spaces, so it survives copy and paste through any shell.
export function encodeEnrollment(blob: EnrollmentBlob): string {
  return Buffer.from(JSON.stringify(blob)).toString("base64url")
}

// Accepts a token from encodeEnrollment, or the raw JSON it encodes.
export function decodeEnrollment(text: string): EnrollmentBlob {
  const t = text.trim()
  const json = t.startsWith("{") ? t : Buffer.from(t, "base64url").toString("utf8")
  return JSON.parse(json) as EnrollmentBlob
}
