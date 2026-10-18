import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { basicAuth, fetchJson, secret } from "./http.js"

test("secret reads the value, a file, or an environment variable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "secret-"))
  writeFileSync(join(dir, "t"), "from-file\n")
  process.env.PERIAPSIS_TEST_TOKEN = "from-env"
  assert.equal(await secret({ token: "inline" }, "token"), "inline")
  assert.equal(await secret({ tokenFile: join(dir, "t") }, "token"), "from-file")
  assert.equal(await secret({ tokenEnv: "PERIAPSIS_TEST_TOKEN" }, "token"), "from-env")
  await assert.rejects(secret({}, "token"), /needs token, tokenFile or tokenEnv/)
  await assert.rejects(secret({ tokenEnv: "PERIAPSIS_UNSET_X" }, "token"), /is not set/)
})

test("basicAuth encodes user and token", () => {
  assert.equal(basicAuth("a@b.c", "t"), `Basic ${Buffer.from("a@b.c:t").toString("base64")}`)
})

test("fetchJson retries a 5xx and reports the host on failure", async () => {
  const orig = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return calls === 1
      ? { ok: false, status: 502, text: async () => "bad gateway" }
      : { ok: true, status: 200, json: async () => ({ ok: 1 }) }
  }) as unknown as typeof fetch
  try {
    assert.deepEqual(await fetchJson("https://api.example.com/x"), { ok: 1 })
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    })) as unknown as typeof fetch
    await assert.rejects(
      fetchJson("https://api.example.com/x"),
      /api.example.com 401: unauthorized/,
    )
  } finally {
    globalThis.fetch = orig
  }
})
