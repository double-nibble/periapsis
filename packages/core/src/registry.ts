import { type PublicIdentity, generateIdentity } from "./sealed.js"
import { sign, verify } from "./signing.js"

export interface Registry {
  identities: Record<string, PublicIdentity>
  signedAt: number
}

export interface SignedRegistry {
  registry: Registry
  signature: string
}

// A machine's own keys plus the public identity it registers.
export function keygen(): {
  identity: import("./sealed.js").IdentityKeys
  publicIdentity: PublicIdentity
} {
  const identity = generateIdentity()
  return {
    identity,
    publicIdentity: { signPublic: identity.signPublic, boxPublic: identity.boxPublic },
  }
}

export function signRegistry(registry: Registry, rootSignPrivate: string): SignedRegistry {
  return { registry, signature: sign(registry, rootSignPrivate) }
}

export function verifyRegistry(doc: SignedRegistry, rootSignPublic: string): boolean {
  return verify(doc.registry, doc.signature, rootSignPublic)
}

export function lookup(registry: Registry, identity: string): PublicIdentity | null {
  return registry.identities[identity] ?? null
}
