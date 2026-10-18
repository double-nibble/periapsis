import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { type Registry, type SignedRegistry, isId, keygen, signRegistry } from "@periapsis/core"
import { NatsBroker } from "@periapsis/transport"
import {
  type EnrollmentBlob,
  type RootKeys,
  accountsConf,
  accountsFromRegistry,
  buildEnrollment,
  decodeEnrollment,
  encodeEnrollment,
  enrollSigned,
  newNatsUser,
} from "./enroll.js"
import { urlProblem } from "./urls.js"

function usage(): never {
  process.stderr.write(
    [
      "periapsis <command>",
      "",
      "  keygen <name>              Generate an identity keypair.",
      "                            Writes <name>.key (private, keep local) and",
      "                            prints the public identity JSON to stdout.",
      "",
      "  bootstrap --broker <wss-url> --registry <url> --root-pub <root.pub.json>",
      "                            Write bootstrap.json (public broker URL, registry URL,",
      "                            and root signing key) for the installer to fetch.",
      "",
      "  reporter-enroll --account A --broker <wss-url> --registry <url>",
      "             --root-pub <root.pub.json> [--instances F] [--every-ms N] [--out F]",
      "                            On the reporter: generate its own identity and nkey,",
      "                            write a private config.json, and print a public",
      "                            enrollment line for the operator to authorize.",
      "",
      "  enroll [token] --root-key <root.key> [--registry-file F] [--blob F]",
      "                            Authorize an enrollment (token, stdin or --blob):",
      "                            verify the signed registry F (default",
      "                            signed-registry.json; new if absent) under the root",
      "                            key, add the identity and its nkey, and re-sign it.",
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
      "                            Write hub-config.json (with the hub's own nkey seed)",
      "                            and print the hub's enrollment token.",
      "",
      "  broker-accounts --registry-file <signed-registry.json> [--out F]",
      "                            Write accounts.conf: NATS authorization for every",
      "                            enrolled nkey in the registry.",
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
    process.stderr.write(`broker-check: ${(err as Error).message}\n`)
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
  const badUrl =
    urlProblem(broker, ["wss:", "ws:"], "--broker") ??
    urlProblem(registry, ["https:"], "--registry")
  if (badUrl) {
    process.stderr.write(`${badUrl}\n`)
    process.exit(1)
  }
  const out = "hub-config.json"
  if (existsSync(out)) {
    process.stderr.write(`${out} already exists; refusing to overwrite. Remove it first.\n`)
    process.exit(1)
  }
  const hub = JSON.parse(readFileSync(hubKey, "utf8")) as {
    boxPrivate?: string
    signPublic?: string
    boxPublic?: string
  }
  if (!hub.boxPrivate || !hub.signPublic || !hub.boxPublic) {
    process.stderr.write(`${hubKey} has no identity keys; is it a hub key file?\n`)
    process.exit(1)
  }
  const rootSignPublic = rootSignPublicFrom(
    JSON.parse(readFileSync(rootPub, "utf8")) as Record<string, unknown>,
  )
  if (!rootSignPublic) {
    process.stderr.write(`${rootPub} has no signPublic\n`)
    process.exit(1)
  }
  const user = newNatsUser()
  const config: Record<string, unknown> = {
    brokerUrl: broker,
    registryUrl: registry,
    rootSignPublic,
    boxPrivate: hub.boxPrivate,
    natsSeed: user.seed,
    port: f.port ? Number(f.port) : 4747,
    dataDir: f["data-dir"] ?? `${process.env.HOME}/.periapsis-hub`,
  }
  writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  const blob = {
    account: "hub",
    identity: { signPublic: hub.signPublic, boxPublic: hub.boxPublic },
    nkey: user.publicKey,
  }
  process.stdout.write(`${encodeEnrollment(blob)}\n`)
  process.stderr.write(
    `wrote ${out} (hub box private key and nkey seed — keep it local).\nEnroll the hub with the line printed above: periapsis enroll\n`,
  )
}

function cmdBrokerAccounts(args: string[]): void {
  const f = parseFlags(args)
  const regFile = f["registry-file"]
  if (!regFile) usage()
  const doc = JSON.parse(readFileSync(regFile, "utf8")) as SignedRegistry | Registry
  const registry = "registry" in doc ? doc.registry : doc
  const accounts = accountsFromRegistry(registry)
  if (!accounts.hub) {
    process.stderr.write("the registry has no hub nkey; enroll the hub first\n")
    process.exit(1)
  }
  const out = f.out ?? "accounts.conf"
  writeFileSync(out, accountsConf(accounts), { mode: 0o600 })
  process.stderr.write(
    `wrote ${out} for ${Object.keys(accounts).length} accounts (install it on the broker)\n`,
  )
}

const [cmd, ...args] = process.argv.slice(2)
function cmdReporterEnroll(args: string[]): void {
  const f = parseFlags(args)
  const account = f.account
  const broker = f.broker
  const registry = f.registry
  const rootPub = f["root-pub"]
  if (!account || !broker || !registry || !rootPub) usage()
  const badUrl =
    urlProblem(broker, ["wss:", "ws:"], "--broker") ??
    urlProblem(registry, ["https:"], "--registry")
  if (badUrl) {
    process.stderr.write(`${badUrl}\n`)
    process.exit(1)
  }
  if (!isId(account)) {
    process.stderr.write(`invalid account id: ${account}\n`)
    process.exit(1)
  }
  const rootSignPublic = rootSignPublicFrom(
    JSON.parse(readFileSync(rootPub, "utf8")) as Record<string, unknown>,
  )
  if (!rootSignPublic) {
    process.stderr.write(`${rootPub} has no signPublic\n`)
    process.exit(1)
  }
  const instances = f.instances ? (JSON.parse(readFileSync(f.instances, "utf8")) as unknown) : []
  if (!Array.isArray(instances)) {
    process.stderr.write(`${f.instances} must be a JSON array of instances\n`)
    process.exit(1)
  }
  const out = f.out ?? "config.json"
  if (existsSync(out)) {
    process.stderr.write(`${out} already exists; refusing to overwrite. Remove it first.\n`)
    process.exit(1)
  }
  const { secrets, blob } = buildEnrollment(account)
  const config = {
    account,
    brokerUrl: broker,
    registryUrl: registry,
    rootSignPublic,
    signPrivate: secrets.signPrivate,
    boxPrivate: secrets.boxPrivate,
    natsSeed: secrets.natsSeed,
    instances,
    everyMs: f["every-ms"] ? Number(f["every-ms"]) : 60_000,
  }
  writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  process.stdout.write(`${encodeEnrollment(blob)}\n`)
  process.stderr.write(
    `wrote ${out} (private keys and nkey seed — stays on this machine).\nSend the enrollment line printed above to the operator to authorize.\n`,
  )
}

function cmdEnroll(args: string[]): void {
  const token = args[0] && !args[0].startsWith("--") ? args[0] : undefined
  const f = parseFlags(token ? args.slice(1) : args)
  const rootKey = f["root-key"]
  if (!rootKey) usage()
  const regFile = f["registry-file"] ?? "signed-registry.json"
  const text = token ?? (f.blob ? readFileSync(f.blob, "utf8") : readFileSync(0, "utf8"))
  let blob: Partial<EnrollmentBlob>
  try {
    blob = decodeEnrollment(text)
  } catch {
    process.stderr.write("not an enrollment token; paste the whole line the installer printed\n")
    process.exit(1)
  }
  if (!blob.account || !isId(blob.account) || !blob.identity || !blob.nkey) {
    process.stderr.write("enrollment must have account, identity, and nkey\n")
    process.exit(1)
  }
  const root = JSON.parse(readFileSync(rootKey, "utf8")) as Partial<RootKeys>
  if (!root.signPublic || !root.signPrivate) {
    process.stderr.write(`${rootKey} is not a root key file\n`)
    process.exit(1)
  }
  const current = existsSync(regFile)
    ? (JSON.parse(readFileSync(regFile, "utf8")) as SignedRegistry)
    : null
  let result: ReturnType<typeof enrollSigned>
  try {
    result = enrollSigned(
      current,
      { account: blob.account, identity: blob.identity, nkey: blob.nkey },
      { signPublic: root.signPublic, signPrivate: root.signPrivate },
    )
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`)
    process.exit(1)
  }
  writeFileSync(regFile, `${JSON.stringify(result.signed, null, 2)}\n`)
  const verb = result.replaced ? "re-enrolled (replaced the previous keys for)" : "enrolled"
  process.stderr.write(`${verb} ${blob.account}; signed ${regFile}\n`)
}

function cmdBootstrap(args: string[]): void {
  const f = parseFlags(args)
  const broker = f.broker
  const registry = f.registry
  const rootPub = f["root-pub"]
  if (!broker || !registry || !rootPub) usage()
  const badUrl =
    urlProblem(broker, ["wss:", "ws:"], "--broker") ??
    urlProblem(registry, ["https:"], "--registry")
  if (badUrl) {
    process.stderr.write(`${badUrl}\n`)
    process.exit(1)
  }
  const rootSignPublic = rootSignPublicFrom(
    JSON.parse(readFileSync(rootPub, "utf8")) as Record<string, unknown>,
  )
  if (!rootSignPublic) {
    process.stderr.write(`${rootPub} has no signPublic\n`)
    process.exit(1)
  }
  const out = f.out ?? "bootstrap.json"
  const doc = { brokerUrl: broker, registryUrl: registry, rootSignPublic }
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`)
  process.stderr.write(`wrote ${out} (public — upload it to your status site)\n`)
}

if (cmd === "bootstrap") cmdBootstrap(args)
else if (cmd === "reporter-enroll") cmdReporterEnroll(args)
else if (cmd === "enroll") cmdEnroll(args)
else if (cmd === "keygen" && args[0]) cmdKeygen(args[0])
else if (cmd === "registry-add" && args[0] && args[1]) cmdRegistryAdd(args[0], args[1])
else if (cmd === "sign-registry" && args[0] && args[1]) cmdSignRegistry(args[0], args[1])
else if (cmd === "broker-check" && args[0]) await cmdBrokerCheck(args[0])
else if (cmd === "hub-config") cmdHubConfig(args)
else if (cmd === "broker-accounts") cmdBrokerAccounts(args)
else usage()
