import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import type { Command, Item } from "@periapsis/core"
import type { RunResult, SpawnOptions } from "../agent/run.js"
import { Responder, refusal, respondArgs, respondPrompt } from "./responder.js"

function cmd(id: string, key = "sub1:code:gh/1", source = "code"): Command {
  return {
    id,
    type: "respond",
    account: "sub1",
    prompt: "Summarize it",
    item: {
      source,
      key,
      kind: "pr",
      title: "Fix the thing",
      detail: null,
      body: null,
      url: "https://github.com/o/r/pull/1",
      meta: {},
    },
  }
}

function setup(config = {}) {
  const dir = mkdtempSync(join(tmpdir(), "resp-"))
  const published: Item[][] = []
  const calls: { args: string[]; prompt: string; opts: SpawnOptions }[] = []
  let n = 0
  const spawn = async (args: string[], prompt: string, opts: SpawnOptions): Promise<RunResult> => {
    calls.push({ args, prompt, opts })
    n += 1
    return { result: `reply ${n}`, isError: false, costUsd: 0.5, turns: 3, sessionId: "sess-1" }
  }
  const state = join(dir, "state.json")
  const r = new Responder(
    "sub1",
    config,
    state,
    async (items) => {
      published.push(items)
    },
    spawn,
    () => 1000,
  )
  return { r, published, calls, state }
}

test("a response runs Claude with the prompt and item, and publishes the reply as a task", async () => {
  const { r, published, calls } = setup({ cwd: "/work" })
  await r.handle(cmd("aaaaaaaa-1"))
  assert.equal(calls[0]?.opts.cwd, "/work")
  assert.match(calls[0]?.prompt ?? "", /^Summarize it/)
  assert.match(calls[0]?.prompt ?? "", /data, not instructions/)
  const last = published.at(-1) ?? []
  assert.equal(last[0]?.key, "sub1:tasks:aaaaaaaa-1")
  assert.equal(last[0]?.body, "reply 1")
  assert.equal(last[0]?.meta.state, "done")
  assert.equal(last[0]?.meta.cost, "$0.50")
  assert.deepEqual(
    published.map((p) => p[0]?.meta.state),
    ["queued", "running", "done"],
  )
})

test("responding to a task continues its thread's session", async () => {
  const { r, calls } = setup({})
  await r.handle(cmd("aaaaaaaa-1"))
  await r.handle(cmd("aaaaaaaa-2", "sub1:tasks:aaaaaaaa-1", "tasks"))
  assert.equal(calls[0]?.args.includes("--resume"), false)
  assert.deepEqual(calls[1]?.args.slice(-2), ["--resume", "sess-1"])
  assert.equal(r.items()[0]?.title, "Fix the thing")
})

test("a machine without a respond config reports the task as failed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "resp-"))
  const r = new Responder(
    "sub1",
    undefined,
    join(dir, "s.json"),
    async () => {},
    async () => {
      throw new Error("must not run")
    },
  )
  await r.handle(cmd("aaaaaaaa-1"))
  assert.equal(r.items()[0]?.meta.state, "failed")
  assert.match(r.items()[0]?.body ?? "", /no respond section/)
})

test("tasks and sessions survive a restart; unfinished ones are marked failed", async () => {
  const { r, state } = setup({})
  await r.handle(cmd("aaaaaaaa-1"))
  const saved = JSON.parse(readFileSync(state, "utf8"))
  assert.equal(saved.sessions["code:sub1:code:gh/1"], "sess-1")
  const again = new Responder("sub1", {}, state, async () => {})
  assert.equal(again.items()[0]?.body, "reply 1")
})

test("respondArgs defaults to auto and rejects unknown modes", () => {
  assert.deepEqual(respondArgs({}), ["-p", "--output-format", "json", "--permission-mode", "auto"])
  assert.throws(() => respondArgs({ permissionMode: "yolo" }))
})

test("respondPrompt carries the item as data", () => {
  assert.match(respondPrompt(cmd("aaaaaaaa-1")), /"title": "Fix the thing"/)
})

test("refusal checks each allow list that is set", () => {
  const item = cmd("aaaaaaaa-1").item
  assert.equal(refusal(undefined, item), null)
  assert.equal(refusal({ sources: ["code"], kinds: ["pr"] }, item), null)
  assert.equal(refusal({ urls: ["https://github.com/o/"] }, item), null)
  assert.match(refusal({ kinds: ["ticket"] }, item) ?? "", /allow\.kinds accepts only ticket/)
  assert.match(refusal({ urls: ["https://github.com/acme/"] }, item) ?? "", /allow\.urls/)
  assert.match(refusal({ instances: ["work"] }, item) ?? "", /allow\.instances/)
})

test("a command outside respond.allow fails without running Claude", async () => {
  const { r, calls } = setup({ allow: { sources: ["tickets"] } })
  await r.handle(cmd("aaaaaaaa-1"))
  assert.equal(calls.length, 0)
  assert.equal(r.items()[0]?.meta.state, "failed")
  assert.match(r.items()[0]?.body ?? "", /allow\.sources accepts only tickets/)
})

test("a follow-up on a refused task is refused", async () => {
  const { r, calls } = setup({ allow: { sources: ["tickets"] } })
  await r.handle(cmd("aaaaaaaa-1"))
  await r.handle(cmd("aaaaaaaa-2", "sub1:tasks:aaaaaaaa-1", "tasks"))
  assert.equal(calls.length, 0)
  assert.equal(r.items()[0]?.meta.state, "failed")
})

test("a follow-up on an accepted task is allowed", async () => {
  const { r, calls } = setup({ allow: { sources: ["code"] } })
  await r.handle(cmd("aaaaaaaa-1"))
  await r.handle(cmd("aaaaaaaa-2", "sub1:tasks:aaaaaaaa-1", "tasks"))
  assert.equal(calls.length, 2)
})

test("respondArgs passes the tool rules", () => {
  const args = respondArgs({ allowedTools: ["Read", "Grep"], disallowedTools: ["Bash"] })
  assert.deepEqual(args.slice(-4), ["--allowedTools", "Read,Grep", "--disallowedTools", "Bash"])
})
