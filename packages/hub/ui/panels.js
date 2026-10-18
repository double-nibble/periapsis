import { snoozeOptions } from "./view.js"

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
