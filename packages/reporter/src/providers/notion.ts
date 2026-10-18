import type { InstanceConfig, Provider, ProviderItem, ProviderResult } from "../provider.js"
import { fetchJson, secret } from "./http.js"

const API = "https://api.notion.com/v1"
const VERSION = "2026-03-11"
const MAX_PAGES = 25

interface RichText {
  plain_text?: string
}

interface NotionPage {
  id: string
  object?: string
  url?: string
  last_edited_time?: string
  properties?: Record<string, { type?: string; title?: RichText[] }>
}

export interface NotionComment {
  id: string
  discussion_id: string
  created_time: string
  created_by: { id: string }
  rich_text: RichText[]
}

export interface NotionBlock {
  id: string
  type: string
  to_do?: { checked: boolean; rich_text: RichText[] }
}

interface List<T> {
  results: T[]
  has_more?: boolean
  next_cursor?: string | null
}

const text = (rt: RichText[] = []) => rt.map((t) => t.plain_text ?? "").join("")

export function pageTitle(page: NotionPage): string {
  const prop = Object.values(page.properties ?? {}).find((p) => p.type === "title")
  return text(prop?.title) || "Untitled"
}

// A page id from a Notion URL or a bare id, dashed or not.
export function pageId(ref: string): string {
  const hex = ref.replace(/-/g, "").match(/[0-9a-f]{32}(?=[^0-9a-f]*$)/i)?.[0]
  if (!hex) throw new Error(`not a Notion page: ${ref}`)
  return hex.toLowerCase()
}

// One item per page: its open discussions, those whose last comment is not
// yours, and its unchecked to-dos.
export function notionItem(
  page: NotionPage,
  comments: NotionComment[],
  blocks: NotionBlock[],
  me: string | null,
  instance: string,
): ProviderItem {
  const latest = new Map<string, NotionComment>()
  for (const c of comments) {
    const prev = latest.get(c.discussion_id)
    if (!prev || c.created_time > prev.created_time) latest.set(c.discussion_id, c)
  }
  const open = [...latest.values()]
  const toAnswer = me ? open.filter((c) => c.created_by.id !== me) : []
  const todos = blocks.filter((b) => b.type === "to_do" && b.to_do && !b.to_do.checked)
  const action = toAnswer.length
    ? `Answer ${toAnswer.length} comment thread${toAnswer.length > 1 ? "s" : ""}`
    : null
  const body = [
    ...open.map((c) => `- ${text(c.rich_text).slice(0, 200)}`),
    ...todos.map((b) => `- [ ] ${text(b.to_do?.rich_text)}`),
  ].join("\n")
  return {
    key: page.id,
    kind: "doc",
    priority: action ? 1 : 3,
    title: pageTitle(page),
    detail: action ?? undefined,
    url: page.url,
    fingerprint: `${page.last_edited_time ?? ""}:${[...latest.keys()].sort().join(",")}:${open
      .map((c) => c.id)
      .sort()
      .join(",")}`,
    meta: {
      instance,
      ...(page.last_edited_time ? { edited: page.last_edited_time } : {}),
      threads: String(open.length),
      toAnswer: String(toAnswer.length),
      todos: String(todos.length),
      ...(action ? { action } : {}),
    },
    ...(body ? { body } : {}),
  }
}

// Params: { token (or tokenFile / tokenEnv), pages?, query?, email? }. Reads
// the listed pages, or those whose title matches query (default "RFC"), that
// are shared with the integration: their unresolved page comments and
// unchecked top-level to-dos. With email, threads whose last comment is not
// yours ask you to answer.
export const notion: Provider = {
  source: "docs",
  async read(config: InstanceConfig): Promise<ProviderResult> {
    const params = config.params ?? {}
    const headers = {
      authorization: `Bearer ${await secret(params, "token")}`,
      "notion-version": VERSION,
      "content-type": "application/json",
    }
    const get = <T>(path: string) => fetchJson<T>(`${API}${path}`, { headers })
    const all = async <T>(path: string, max = 500): Promise<T[]> => {
      const out: T[] = []
      let cursor: string | null | undefined
      do {
        const sep = path.includes("?") ? "&" : "?"
        const page = await get<List<T>>(
          `${path}${sep}page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`,
        )
        out.push(...page.results)
        cursor = page.has_more ? page.next_cursor : null
      } while (cursor && out.length < max)
      return out
    }
    let pages: NotionPage[]
    if (Array.isArray(params.pages) && params.pages.length) {
      pages = await Promise.all(
        params.pages.map((p) => get<NotionPage>(`/pages/${pageId(String(p))}`)),
      )
    } else {
      const query = typeof params.query === "string" ? params.query : "RFC"
      const found = await fetchJson<List<NotionPage>>(`${API}/search`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query,
          filter: { property: "object", value: "page" },
          sort: { timestamp: "last_edited_time", direction: "descending" },
          page_size: MAX_PAGES,
        }),
      })
      pages = found.results.filter(
        (p) => p.url && pageTitle(p).toLowerCase().includes(query.toLowerCase()),
      )
    }
    let me: string | null = null
    if (typeof params.email === "string" && params.email) {
      const users = await all<{ id: string; type?: string; person?: { email?: string } }>("/users")
      me =
        users.find((u) => u.person?.email?.toLowerCase() === String(params.email).toLowerCase())
          ?.id ?? null
      if (!me)
        throw new Error(
          `no Notion user with email ${params.email}; the integration needs to read user emails`,
        )
    }
    const items: ProviderItem[] = []
    for (const page of pages.slice(0, MAX_PAGES)) {
      const [comments, blocks] = await Promise.all([
        all<NotionComment>(`/comments?block_id=${page.id}`),
        all<NotionBlock>(`/blocks/${page.id}/children`),
      ])
      items.push(notionItem(page, comments, blocks, me, config.instance))
    }
    return { items }
  },
}
