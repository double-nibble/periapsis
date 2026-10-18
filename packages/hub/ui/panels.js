import { ago, snoozeOptions } from "./view.js"

export function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function panel(title, count) {
  const box = el("section", "panel")
  const head = el("div", "panel-head")
  head.append(el("span", "panel-title", title))
  if (count != null) head.append(el("span", "panel-count mono", String(count)))
  box.append(head)
  return box
}

export function accountTag(ctx, account) {
  return el("span", `who-tag mono ${ctx.color(account)}`, account)
}

const TILES = [
  ["now", "Now"],
  ["needs", "Needs you"],
  ["later", "Later"],
  ["resolvedToday", "Resolved today"],
  ["openPrs", "Your open PRs"],
  ["toReview", "To review"],
]

export function statsTiles(stats) {
  const row = el("div", "tiles")
  for (const [key, label] of TILES) {
    const tile = el("div", `tile${key === "now" && stats[key] > 0 ? " hot" : ""}`)
    tile.append(el("div", "tile-num mono", String(stats[key] ?? 0)), el("div", "tile-label", label))
    row.append(tile)
  }
  return row
}

// Open, Done, Not now and Snooze, each acting on the item at once.
function rowActions(ctx, item) {
  const box = el("div", "row-actions")
  const ref = { account: item.account, source: item.source, key: item.key }
  const act = (action, extra = {}) => ctx.post("/api/act", { ...ref, action, ...extra })
  const button = (label, fn) => {
    const b = el("button", "btn small", label)
    b.addEventListener("click", (e) => {
      e.stopPropagation()
      fn()
    })
    return b
  }
  if (item.url) box.append(button("Open", () => window.open(item.url, "_blank", "noreferrer")))
  else box.append(el("span"))
  box.append(
    button("Done", () => act("done")),
    button("Not now", () => act("dismiss")),
  )
  const snooze = el("select", "btn small")
  snooze.append(el("option", null, "Snooze"))
  const options = snoozeOptions(new Date())
  for (const o of options) snooze.append(el("option", null, o.label))
  snooze.addEventListener("click", (e) => e.stopPropagation())
  snooze.addEventListener("change", () => {
    const o = options[snooze.selectedIndex - 1]
    if (o) act("snooze", { until: o.until })
  })
  box.append(snooze)
  return box
}

function needRow(ctx, item) {
  const row = el("div", `need p${item.priority}`)
  row.tabIndex = 0
  row.setAttribute("role", "button")
  const main = el("div", "need-main")
  main.append(el("div", "need-title", item.title))
  if (item.detail) main.append(el("div", "need-detail", item.detail))
  const tags = el("div", "tags")
  tags.append(accountTag(ctx, item.account), el("span", "tag", item.meta.instance ?? item.source))
  if (item.group) tags.append(el("span", "tag muted", item.group))
  main.append(tags)
  row.append(main, rowActions(ctx, item))
  row.addEventListener("click", () => ctx.open(item))
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target === row) ctx.open(item)
  })
  return row
}

const BANDS = [
  [1, "Now", "now"],
  [2, "Soon", "soon"],
  [3, "When you can", "later"],
]

export function needsPanel(ctx, items) {
  const box = panel("Needs you", items.length)
  if (items.length === 0) box.append(el("p", "empty", "Nothing needs you."))
  for (const [priority, label, cls] of BANDS) {
    const band = items.filter((i) => i.priority === priority)
    if (band.length === 0) continue
    box.append(el("div", `band ${cls}`, label))
    for (const item of band) box.append(needRow(ctx, item))
  }
  return box
}

const BADGE = {
  draft: "amber",
  ready: "green",
  "ci-failed": "red",
  changes: "red",
  conflict: "red",
  reply: "amber",
}

function prRow(ctx, pr) {
  const m = pr.meta
  const row = el("div", `pr${pr.status === "active" ? "" : " hidden"}`)
  row.tabIndex = 0
  row.setAttribute("role", "button")
  const top = el("div", "pr-top")
  top.append(el("span", "pr-ref mono", m.ref ?? ""), el("span", "pr-title", m.prTitle ?? pr.title))
  const facts = el("div", "pr-facts")
  const fact = (text, cls = "") => facts.append(el("span", `fact ${cls}`, text))
  fact(m.size ?? "", "mono")
  if (m.createdAt) fact(`opened ${ago(m.createdAt)} ago`)
  if (m.role === "reviewer" && m.author) fact(`by ${m.author}`)
  if (m.stackedOn) fact(`stacked on ${m.stackedOn}`, "mono")
  if (m.waitingOn) fact(`waiting on ${m.waitingOn}`)
  if (m.checks === "pass") fact("checks pass")
  else if (m.checks && m.checks !== "none") fact(m.checks, m.failing ? "red" : "")
  if (m.threads && m.threads !== "0") fact(`${m.threads} open threads`)
  if (m.action && m.role === "author") fact(m.action, "action")
  const side = el("div", "pr-side")
  side.append(
    el("span", `badge ${BADGE[m.status] ?? ""}`, m.statusLabel ?? ""),
    accountTag(ctx, pr.account),
  )
  row.append(el("div", "pr-main"), side)
  row.firstChild.append(top, facts)
  row.addEventListener("click", () => ctx.open(pr))
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter") ctx.open(pr)
  })
  return row
}

function prGroup(ctx, name, note, prs, open) {
  const box = el("details", "pr-group")
  box.open = open
  const sum = el("summary")
  sum.append(el("span", "group-name", name), el("span", "group-count mono", String(prs.length)))
  if (note) sum.append(el("span", "group-note", note))
  box.append(sum)
  for (const pr of prs) box.append(prRow(ctx, pr))
  return box
}

// Review requests first, then the operator's own PRs by repository; hidden
// PRs stay listed, dimmed.
export function prsPanel(ctx, prs, openGroups) {
  const box = panel("Pull requests", prs.length)
  if (prs.length === 0) box.append(el("p", "empty", "No open pull requests."))
  const review = prs.filter((p) => p.meta.role === "reviewer")
  const byRepo = new Map()
  for (const pr of prs.filter((p) => p.meta.role !== "reviewer")) {
    const repo = pr.meta.repo ?? pr.group ?? "other"
    byRepo.set(repo, [...(byRepo.get(repo) ?? []), pr])
  }
  const urgency = (list) => Math.min(...list.map((p) => p.priority))
  const groups = [
    ...(review.length ? [["Review requests", "for you", review]] : []),
    ...[...byRepo]
      .sort(([a, x], [b, y]) => urgency(x) - urgency(y) || a.localeCompare(b))
      .map(([repo, list]) => [repo, "repository", list]),
  ]
  for (const [name, note, list] of groups) {
    const sorted = [...list].sort((a, b) => a.priority - b.priority)
    const group = prGroup(ctx, name, note, sorted, openGroups.get(name) ?? true)
    group.addEventListener("toggle", () => openGroups.set(name, group.open))
    box.append(group)
  }
  return box
}

// The day's plan: a headline and ordered steps, each tagged with its account.
export function todayPanel(ctx, briefing, who) {
  const box = el("section", "panel today")
  const head = el("div", "panel-head")
  head.append(el("span", "panel-title", "Today"))
  const when = briefing?.running
    ? "planning…"
    : briefing?.at
      ? `planned ${ago(new Date(briefing.at).toISOString())} ago`
      : ""
  head.append(el("span", "panel-when", when))
  const again = el("button", "replan", "↻")
  again.title = "Plan again now"
  again.setAttribute("aria-label", "Plan again now")
  again.disabled = Boolean(briefing?.running)
  again.addEventListener("click", () => ctx.post("/api/plan", {}))
  head.append(again)
  box.append(head)
  const body = el("div", "today-body")
  if (briefing?.error) body.append(el("p", "today-error", briefing.error))
  if (!briefing?.headline) {
    if (!briefing?.error) body.append(el("p", "empty", "No plan yet."))
    box.append(body)
    return box
  }
  body.append(el("p", "today-headline", briefing.headline))
  const list = el("ol", "today-steps")
  for (const step of briefing.steps) {
    if (who !== "All" && step.account && step.account !== who) continue
    const li = el("li")
    if (step.account) li.append(accountTag(ctx, step.account), " ")
    li.append(step.text)
    list.append(li)
  }
  body.append(list)
  box.append(body)
  return box
}
