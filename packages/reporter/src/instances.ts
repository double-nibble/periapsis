import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { ReporterConfig } from "./runtime.js"

type Instances = ReporterConfig["account"]["instances"]

// A reporter config's instances: an inline array, or a path (relative to the
// config file) read on every start, so editing that file takes effect on
// restart. Returns where they came from, for the startup log.
export function loadInstances(
  value: unknown,
  configPath: string,
): { instances: Instances; from: string } {
  if (value === undefined) return { instances: [], from: configPath }
  if (Array.isArray(value)) return { instances: value as Instances, from: configPath }
  if (typeof value !== "string")
    throw new Error(`instances in ${configPath} must be an array or a path to one`)
  const path = resolve(dirname(configPath), value)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch (err) {
    throw new Error(`cannot read instances from ${path}: ${(err as Error).message}`)
  }
  if (!Array.isArray(parsed)) throw new Error(`${path} must be a JSON array of instances`)
  return { instances: parsed as Instances, from: path }
}
