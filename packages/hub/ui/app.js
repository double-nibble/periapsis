import { itemsFor, urgent } from "./view.js"

const roster = document.getElementById("roster")
const detail = document.getElementById("detail")
const schedule = document.getElementById("schedule")
const toggle = document.getElementById("nav-toggle")

let model = { accounts: [], schedule: [] }
let who = null

const NAV_KEY = "periapsis.nav.collapsed"

function setCollapsed(collapsed) {
  document.body.classList.toggle("nav-collapsed", collapsed)
  toggle.setAttribute("aria-expanded", String(!collapsed))
  try {
    localStorage.setItem(NAV_KEY, collapsed ? "1" : "0")
  } catch {}
}

toggle.addEventListener("click", () => {
  setCollapsed(!document.body.classList.contains("nav-collapsed"))
})

function rosterButton(label, items) {
  const btn = document.createElement("button")
  btn.className = "acct"
  btn.setAttribute("aria-current", String(label === who))
  const u = urgent(items)
  const name = document.createElement("span")
  name.className = "name"
  name.textContent = label
  const count = document.createElement("span")
  count.className = u > 0 ? "count urgent mono" : "count mono"
  count.textContent = u > 0 ? `${items.length} · ${u}!` : String(items.length)
  btn.append(name, count)
  btn.addEventListener("click", () => {
    who = label
    render()
  })
  return btn
}

function renderRoster() {
  roster.replaceChildren()
  roster.append(rosterButton("All", itemsFor(model, "All")))
  for (const acct of model.accounts) roster.append(rosterButton(acct.account, acct.items))
}

function renderSchedule() {
  schedule.replaceChildren()
  if (model.schedule.length === 0) {
    schedule.className = "schedule empty"
    schedule.textContent = "Nothing scheduled across the fleet today"
    return
  }
  schedule.className = "schedule"
  for (const s of model.schedule) {
    const slot = document.createElement("div")
    slot.className = "slot"
    const time = document.createElement("span")
    time.className = "time"
    time.textContent = (s.at.split("T")[1] || s.at).slice(0, 5)
    const ev = document.createElement("span")
    ev.className = "ev"
    ev.textContent = s.title
    const w = document.createElement("span")
    w.className = "who"
    w.textContent = s.account
    slot.append(time, ev, w)
    schedule.append(slot)
  }
}

function itemRow(item, fleet) {
  const row = document.createElement("div")
  row.className = `item p${item.priority}`
  const bar = document.createElement("div")
  bar.className = "bar"
  const mid = document.createElement("div")
  const title = document.createElement("div")
  title.className = "title"
  if (item.url) {
    const a = document.createElement("a")
    a.href = item.url
    a.textContent = item.title
    a.target = "_blank"
    a.rel = "noreferrer"
    title.append(a)
  } else {
    title.textContent = item.title
  }
  mid.append(title)
  if (item.detail) {
    const d = document.createElement("div")
    d.className = "detail-text"
    d.textContent = item.detail
    mid.append(d)
  }
  const tags = document.createElement("div")
  tags.className = "tags"
  if (fleet) {
    const acct = document.createElement("span")
    acct.className = "who-tag mono"
    acct.textContent = item.account
    tags.append(acct)
  }
  const kind = document.createElement("span")
  kind.className = "kind"
  kind.textContent = item.kind
  tags.append(kind)
  row.append(bar, mid, tags)
  return row
}

function renderDetail() {
  detail.replaceChildren()
  if (!who) {
    const p = document.createElement("p")
    p.className = "empty-detail"
    p.textContent = "Select an account to see what it needs."
    detail.append(p)
    return
  }
  const fleet = who === "All"
  const items = itemsFor(model, who)
  const bySource = new Map()
  for (const item of items) {
    const list = bySource.get(item.source) ?? []
    list.push(item)
    bySource.set(item.source, list)
  }
  for (const [source, group] of bySource) {
    const box = document.createElement("div")
    box.className = "srcgroup"
    const head = document.createElement("div")
    head.className = "srchead"
    const label = document.createElement("span")
    label.textContent = source
    const inst = document.createElement("span")
    inst.className = "inst"
    inst.textContent = [...new Set(group.map((i) => i.meta.instance).filter(Boolean))].join(" / ")
    head.append(label, inst)
    box.append(head)
    for (const item of group) box.append(itemRow(item, fleet))
    detail.append(box)
  }
}

function render() {
  if (!who && model.accounts.length) who = "All"
  renderSchedule()
  renderRoster()
  renderDetail()
}

try {
  setCollapsed(localStorage.getItem(NAV_KEY) === "1")
} catch {}

const es = new EventSource("/api/events")
es.addEventListener("model", (e) => {
  model = JSON.parse(e.data)
  render()
})
