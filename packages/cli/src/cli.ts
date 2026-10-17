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

const [cmd, ...args] = process.argv.slice(2)
if (cmd === "keygen" && args[0]) cmdKeygen(args[0])
else if (cmd === "registry-add" && args[0] && args[1]) cmdRegistryAdd(args[0], args[1])
else if (cmd === "sign-registry" && args[0] && args[1]) cmdSignRegistry(args[0], args[1])
else if (cmd === "broker-check" && args[0]) await cmdBrokerCheck(args[0])
else usage()
