// Bundle the CLI and the reporter into single self-contained ESM files for the
// installer to download. Run after `pnpm build`.
import { build } from "esbuild"
import { mkdirSync } from "node:fs"

mkdirSync("dist-bundle", { recursive: true })

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // A reporter may load an external provider module at runtime via dynamic
  // import; keep dynamic imports external so they resolve on the host.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
}

await build({ ...common, entryPoints: ["packages/cli/dist/cli.js"], outfile: "dist-bundle/periapsis.mjs" })
await build({ ...common, entryPoints: ["packages/reporter/dist/main.js"], outfile: "dist-bundle/reporter.mjs" })
console.log("bundled dist-bundle/periapsis.mjs and dist-bundle/reporter.mjs")
