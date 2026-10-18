import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import type { Command, Item } from "@periapsis/core"
import type { RunResult, SpawnOptions } from "../agent/run.js"
import { Responder, respondArgs, respondPrompt } from "./responder.js"

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
