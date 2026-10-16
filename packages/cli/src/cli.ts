import { readFileSync, writeFileSync } from "node:fs"
import { type Registry, keygen, signRegistry } from "@periapsis/core"

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
    ].join("\n"),
  )
  process.exit(1)
}

function cmdKeygen(name: string): void {
  const { identity, publicIdentity } = keygen()
  writeFileSync(`${name}.key`, JSON.stringify(identity), { mode: 0o600 })
  process.stderr.write(`wrote ${name}.key (private — keep this on the machine only)\n`)
  process.stdout.write(`${JSON.stringify({ [name]: publicIdentity }, null, 2)}\n`)
}

function cmdSignRegistry(rootKeyPath: string, registryPath: string): void {
  const root = JSON.parse(readFileSync(rootKeyPath, "utf8")) as { signPrivate: string }
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Registry
  const signed = signRegistry(registry, root.signPrivate)
  process.stdout.write(`${JSON.stringify(signed, null, 2)}\n`)
}

const [cmd, ...args] = process.argv.slice(2)
if (cmd === "keygen" && args[0]) cmdKeygen(args[0])
else if (cmd === "sign-registry" && args[0] && args[1]) cmdSignRegistry(args[0], args[1])
else usage()
