import { readFile } from "node:fs/promises"
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createLogger } from "@periapsis/core"
import type { Respond } from "./commander.js"
import { type Model, buildModel } from "./model.js"
import type { Store } from "./store.js"

const log = createLogger("hub.http")

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "ui")

export interface HubServer {
  server: Server
  push(): void
  close(): void
}

export interface Actions {
  // The latest plan, and a way to ask for a new one.
  briefing?: () => Model["briefing"]
  plan?: () => void
  // Absent when the hub has no signing key; the reason says why.
  respond?: Respond
  respondUnavailable?: string
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])

// A state-changing request must come from the dashboard itself: a local Host
// (so a rebound DNS name cannot reach it) and a custom header (so another
// site's page cannot send it without a CORS preflight, which is never granted).
function fromDashboard(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "")
  return (
    req.method === "POST" &&
    LOCAL_HOSTS.has(host) &&
    req.headers["x-periapsis"] === "1" &&
    (req.headers["content-type"] ?? "").startsWith("application/json")
  )
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 64_000) throw new Error("request too large")
    chunks.push(chunk as Buffer)
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
  if (!body || typeof body !== "object") throw new Error("body must be an object")
  return body as Record<string, unknown>
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" })
  res.end(JSON.stringify(body))
}

export function startServer(
  store: Store,
  port: number,
  now: () => number = Date.now,
  actions: Actions = {},
): HubServer {
  const clients = new Set<import("node:http").ServerResponse>()
  const build = (): Model => ({
    ...buildModel(store.list(), now(), store.reporters()),
    briefing: actions.briefing?.() ?? null,
  })
  let model: Model = build()

  function push(): void {
    model = build()
    const payload = `event: model\ndata: ${JSON.stringify(model)}\n\n`
    for (const res of clients) res.write(payload)
  }

  async function act(req: IncomingMessage, res: ServerResponse, url: string): Promise<void> {
    if (!fromDashboard(req)) return reply(res, 403, { error: "not from the dashboard" })
    let b: Record<string, unknown>
    try {
      b = await readJson(req)
    } catch (err) {
      return reply(res, 400, { error: (err as Error).message })
    }
    const account = String(b.account)
    const source = String(b.source)
    const key = String(b.key)
    const row = store.get(account, source, key)
    if (!row) return reply(res, 404, { error: "no such item" })
    if (url === "/api/act") {
      try {
        const until = typeof b.until === "number" ? b.until : undefined
        store.act(account, source, key, String(b.action), now(), until)
      } catch (err) {
        return reply(res, 400, { error: (err as Error).message })
      }
      push()
      return reply(res, 200, { ok: true })
    }
    if (!actions.respond)
      return reply(res, 503, { error: actions.respondUnavailable ?? "responding is not set up" })
    if (typeof b.prompt !== "string" || !b.prompt.trim())
      return reply(res, 400, { error: "prompt is required" })
    try {
      return reply(res, 200, { id: await actions.respond(row, b.prompt.trim()) })
    } catch (err) {
      return reply(res, 502, { error: (err as Error).message })
    }
  }

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/"
    log.debug("request", { method: req.method, url })
    if (url === "/api/plan") {
      if (!fromDashboard(req)) return reply(res, 403, { error: "not from the dashboard" })
      if (!actions.plan) return reply(res, 503, { error: "planning is turned off" })
      actions.plan()
      push()
      return reply(res, 200, { ok: true })
    }
    if (url === "/api/act" || url === "/api/respond") {
      await act(req, res, url)
      return
    }
    if (url === "/api/model") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
      res.end(JSON.stringify(model))
      return
    }
    if (url === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      })
      res.write(`event: model\ndata: ${JSON.stringify(model)}\n\n`)
      clients.add(res)
      log.debug("sse open", { clients: clients.size })
      req.on("close", () => {
        clients.delete(res)
        log.debug("sse close", { clients: clients.size })
      })
      return
    }
    const file = url === "/" ? "index.html" : url.slice(1)
    const type = file.endsWith(".css")
      ? "text/css"
      : file.endsWith(".js")
        ? "text/javascript"
        : "text/html"
    try {
      const body = await readFile(join(UI_DIR, file))
      res.writeHead(200, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end("Not found")
    }
  })

  server.listen(port, "127.0.0.1")
  return { server, push, close: () => server.close() }
}
