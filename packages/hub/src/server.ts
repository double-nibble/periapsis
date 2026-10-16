import { readFile } from "node:fs/promises"
import { type Server, createServer } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { type Model, buildModel } from "./model.js"
import type { Store } from "./store.js"

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "ui")

export interface HubServer {
  server: Server
  push(): void
  close(): void
}

export function startServer(store: Store, port: number, now: () => number = Date.now): HubServer {
  const clients = new Set<import("node:http").ServerResponse>()
  let model: Model = buildModel(store.list(), now())

  function push(): void {
    model = buildModel(store.list(), now())
    const payload = `event: model\ndata: ${JSON.stringify(model)}\n\n`
    for (const res of clients) res.write(payload)
  }

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/"
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
      req.on("close", () => clients.delete(res))
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
