import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { type Registry, keygen, signRegistry } from "@periapsis/core"
import { NatsBroker } from "@periapsis/transport"

function usage(): never {
  process.stderr.write(
    [
      "periapsis <command>",
      "",
      "  keygen <name>              Generate an identity keypair.",
      "                            Writes <name>.key (private, keep local) and",
      "                            prints the public identity JSON to stdout.",
      "",
      "  sign-registry <root.key> <registry.json>",
      "                            Sign a registry with the root private key and",
      "                            print the signed document to stdout.",
      "",
      "  registry-add <registry.json> <name.pub.json>",
      "                            Add (or replace) an identity's public key in a",
      "                            registry and print the updated registry to stdout.",
      "",
      "  broker-check <wss-url>     Connect to a broker, print its server INFO,",
      "                            and exit non-zero if it cannot be reached.",
      "",
      "  hub-config --hub-key <hub.key> --root-pub <root.pub.json>",
      "             --broker <wss-url> --registry <url> [--port N] [--data-dir D]",
      "                            Assemble hub-config.json from the hub key and",
      "                            the root public key.",
      "",
    ].join("\n"),
  )
  process.exit(1)
}

function cmdKeygen(name: string): void {
  const keyPath = `${name}.key`
  const pubPath = `${name}.pub.json`
  if (existsSync(keyPath)) {
    process.stderr.write(
      `${keyPath} already exists; refusing to overwrite an identity. Remove it first to regenerate.\n`,
    )
    process.exit(1)
  }
  const { identity, publicIdentity } = keygen()
  writeFileSync(keyPath, JSON.stringify(identity), { mode: 0o600 })
  writeFileSync(pubPath, JSON.stringify({ [name]: publicIdentity }, null, 2))
  process.stderr.write(`wrote ${keyPath} (private — keep this on the machine only)\n`)
  process.stderr.write(`wrote ${pubPath} (public — register this with the operator)\n`)
}

function cmdRegistryAdd(registryPath: string, pubPath: string): void {
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Registry
  const pub = JSON.parse(readFileSync(pubPath, "utf8")) as Record<
    string,
    Registry["identities"][string]
  >
  for (const [name, identity] of Object.entries(pub)) registry.identities[name] = identity
  registry.signedAt = Date.now()
  process.stdout.write(`${JSON.stringify(registry, null, 2)}\n`)
}

function cmdSignRegistry(rootKeyPath: string, registryPath: string): void {
  const root = JSON.parse(readFileSync(rootKeyPath, "utf8")) as { signPrivate: string }
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Registry
  const signed = signRegistry(registry, root.signPrivate)
  process.stdout.write(`${JSON.stringify(signed, null, 2)}\n`)
}

async function cmdBrokerCheck(url: string): Promise<void> {
  let broker: NatsBroker
  try {
    broker = await NatsBroker.connect({ servers: url })
  } catch (err) {
    process.stderr.write(`broker-check: cannot reach ${url}: ${(err as Error).message}\n`)
    process.exit(1)
  }
  const info = broker.info
  if (!info) {
    await broker.close()
    process.stderr.write(`broker-check: connected to ${url} but got no server INFO\n`)
    process.exit(1)
  }
  process.stdout.write(
    [
      `broker-check: ${url} OK`,
      `  server:      ${info.server_name}`,
      `  version:     ${info.version}`,
      `  max_payload: ${info.max_payload}`,
      `  tls:         ${info.tls_required ? "required" : info.tls_available ? "available" : "no"}`,
      `  client_ip:   ${info.client_ip ?? "?"}`,
      "",
    ].join("\n"),
  )
  await broker.close()
}

function parseFlags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < args.length; i += 2) {
    const k = args[i]
    const v = args[i + 1]
    if (k === undefined || !k.startsWith("--") || v === undefined) usage()
    out[k.slice(2)] = v
  }
  return out
}

function rootSignPublicFrom(doc: Record<string, unknown>): string | undefined {
  if (typeof doc.signPublic === "string") return doc.signPublic
  for (const v of Object.values(doc)) {
    const sp = (v as { signPublic?: unknown } | null)?.signPublic
    if (typeof sp === "string") return sp
  }
  return undefined
}

function cmdHubConfig(args: string[]): void {
  const f = parseFlags(args)
  const hubKey = f["hub-key"]
  const rootPub = f["root-pub"]
  const broker = f.broker
  const registry = f.registry
  if (!hubKey || !rootPub || !broker || !registry) usage()
  const out = "hub-config.json"
  if (existsSync(out)) {
    process.stderr.write(`${out} already exists; refusing to overwrite. Remove it first.\n`)
    process.exit(1)
  }
  const hub = JSON.parse(readFileSync(hubKey, "utf8")) as { boxPrivate?: string }
  if (!hub.boxPrivate) {
    process.stderr.write(`${hubKey} has no boxPrivate; is it a hub key file?\n`)
    process.exit(1)
  }
  const rootSignPublic = rootSignPublicFrom(
    JSON.parse(readFileSync(rootPub, "utf8")) as Record<string, unknown>,
  )
  if (!rootSignPublic) {
    process.stderr.write(`${rootPub} has no signPublic\n`)
    process.exit(1)
  }
  const config = {
    brokerUrl: broker,
    registryUrl: registry,
    rootSignPublic,
    boxPrivate: hub.boxPrivate,
    port: f.port ? Number(f.port) : 4747,
    dataDir: f["data-dir"] ?? `${process.env.HOME}/.periapsis-hub`,
  }
  writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  process.stderr.write(`wrote ${out} (contains the hub box private key — keep it local)\n`)
}

const [cmd, ...args] = process.argv.slice(2)
if (cmd === "keygen" && args[0]) cmdKeygen(args[0])
else if (cmd === "registry-add" && args[0] && args[1]) cmdRegistryAdd(args[0], args[1])
else if (cmd === "sign-registry" && args[0] && args[1]) cmdSignRegistry(args[0], args[1])
else if (cmd === "broker-check" && args[0]) await cmdBrokerCheck(args[0])
else if (cmd === "hub-config") cmdHubConfig(args)
else usage()
