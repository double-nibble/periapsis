import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { type Registry, isId, keygen, signRegistry } from "@periapsis/core"
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
      "             [--broker-user U] [--broker-pass P]",
      "                            Assemble hub-config.json from the hub key and",
      "                            the root public key.",
      "",
      "  broker-accounts [--registry-file F | --accounts a,b,c]",
      "                            Generate accounts.conf (NATS per-account auth)",
      "                            and broker-creds.json.",
      "",
      "  reporter-config --account A --account-key <A.key>",
      "             --root-pub <root.pub.json> --broker <wss-url> --registry <url>",
      "             --instances <file> [--every-ms N] [--out F]",
      "                            Assemble a reporter config. NATS password from",
      "                            PERIAPSIS_BROKER_PASS.",
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
  const config: Record<string, unknown> = {
    brokerUrl: broker,
    registryUrl: registry,
    rootSignPublic,
    boxPrivate: hub.boxPrivate,
    port: f.port ? Number(f.port) : 4747,
    dataDir: f["data-dir"] ?? `${process.env.HOME}/.periapsis-hub`,
  }
  if (f["broker-user"]) config.brokerUser = f["broker-user"]
  if (f["broker-pass"]) config.brokerPass = f["broker-pass"]
  writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  process.stderr.write(`wrote ${out} (contains the hub box private key — keep it local)\n`)
}

function cmdBrokerAccounts(args: string[]): void {
  const f = parseFlags(args)
  let names: string[]
  const regFile = f["registry-file"]
  if (regFile) {
    const doc = JSON.parse(readFileSync(regFile, "utf8")) as {
      registry?: { identities?: Record<string, unknown> }
      identities?: Record<string, unknown>
    }
    names = Object.keys(doc.registry?.identities ?? doc.identities ?? {})
  } else if (f.accounts) {
    names = f.accounts
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
  } else {
    usage()
  }
  if (!names.includes("hub")) names.push("hub")
  for (const out of ["accounts.conf", "broker-creds.json"]) {
    if (existsSync(out)) {
      process.stderr.write(`${out} already exists; refusing to overwrite. Remove it first.\n`)
      process.exit(1)
    }
  }
  const creds: Record<string, string> = {}
  const users: string[] = []
  for (const name of names) {
    if (name !== "hub" && !isId(name)) {
      process.stderr.write(`invalid account id: ${name}\n`)
      process.exit(1)
    }
    const password = randomBytes(24).toString("base64url")
    creds[name] = password
    const perms =
      name === "hub"
        ? '{ publish: ["commands.>"], subscribe: ["status.>", "_INBOX.>"] }'
        : `{ publish: ["status.${name}"], subscribe: ["commands.${name}", "_INBOX.>"] }`
    users.push(`    { user: "${name}", password: "${password}", permissions: ${perms} }`)
  }
  const conf = `authorization {\n  users = [\n${users.join("\n")}\n  ]\n}\n`
  writeFileSync("accounts.conf", conf, { mode: 0o600 })
  writeFileSync("broker-creds.json", `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 })
  process.stderr.write(
    "wrote accounts.conf (upload to the broker) and broker-creds.json (keep local)\n",
  )
}

function cmdReporterConfig(args: string[]): void {
  const f = parseFlags(args)
  const account = f.account
  const accountKey = f["account-key"]
  const rootPub = f["root-pub"]
  const broker = f.broker
  const registry = f.registry
  const instancesFile = f.instances
  if (!account || !accountKey || !rootPub || !broker || !registry || !instancesFile) usage()
  if (!isId(account)) {
    process.stderr.write(`invalid account id: ${account}\n`)
    process.exit(1)
  }
  const out = f.out ?? "reporter-config.json"
  if (existsSync(out)) {
    process.stderr.write(`${out} already exists; refusing to overwrite. Remove it first.\n`)
    process.exit(1)
  }
  const key = JSON.parse(readFileSync(accountKey, "utf8")) as { signPrivate?: string }
  if (!key.signPrivate) {
    process.stderr.write(`${accountKey} has no signPrivate; is it an account key file?\n`)
    process.exit(1)
  }
  const rootSignPublic = rootSignPublicFrom(
    JSON.parse(readFileSync(rootPub, "utf8")) as Record<string, unknown>,
  )
  if (!rootSignPublic) {
    process.stderr.write(`${rootPub} has no signPublic\n`)
    process.exit(1)
  }
  const instances = JSON.parse(readFileSync(instancesFile, "utf8")) as unknown
  if (!Array.isArray(instances)) {
    process.stderr.write(`${instancesFile} must be a JSON array of instances\n`)
    process.exit(1)
  }
  const config: Record<string, unknown> = {
    account,
    brokerUrl: broker,
    registryUrl: registry,
    rootSignPublic,
    signPrivate: key.signPrivate,
    instances,
    everyMs: f["every-ms"] ? Number(f["every-ms"]) : 60_000,
  }
  const pass = process.env.PERIAPSIS_BROKER_PASS
  if (pass) {
    config.brokerUser = account
    config.brokerPass = pass
  }
  writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  process.stderr.write(`wrote ${out} (contains the account signing key — keep it local)\n`)
}

const [cmd, ...args] = process.argv.slice(2)
if (cmd === "keygen" && args[0]) cmdKeygen(args[0])
else if (cmd === "registry-add" && args[0] && args[1]) cmdRegistryAdd(args[0], args[1])
else if (cmd === "sign-registry" && args[0] && args[1]) cmdSignRegistry(args[0], args[1])
else if (cmd === "broker-check" && args[0]) await cmdBrokerCheck(args[0])
else if (cmd === "hub-config") cmdHubConfig(args)
else if (cmd === "broker-accounts") cmdBrokerAccounts(args)
else if (cmd === "reporter-config") cmdReporterConfig(args)
else usage()
