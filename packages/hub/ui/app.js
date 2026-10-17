import {
  eventsOn,
  filterByType,
  itemsFor,
  monthGrid,
  presentTypes,
  sameDay,
  urgent,
  weekDays,
} from "./view.js"

const roster = document.getElementById("roster")
const detail = document.getElementById("detail")
const tabs = document.getElementById("tabs")
const toggle = document.getElementById("nav-toggle")

let model = { accounts: [], schedule: [] }
let who = null
let type = "All"
let calRange = "week"

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

function renderTabs() {
  tabs.replaceChildren()
  const present = presentTypes(itemsFor(model, who))
  if (!present.includes(type) && type !== "All") type = "All"
  for (const t of ["All", ...present]) {
    const btn = document.createElement("button")
    btn.className = "tab"
    btn.textContent = t
    btn.setAttribute("aria-current", String(t === type))
    btn.addEventListener("click", () => {
      type = t
      render()
    })
    tabs.append(btn)
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

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function hhmm(at) {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

function eventChip(item) {
  const chip = document.createElement(item.url ? "a" : "div")
  chip.className = "cal-ev"
  if (item.url) {
    chip.href = item.url
    chip.target = "_blank"
    chip.rel = "noreferrer"
  }
  const t = document.createElement("span")
  t.className = "cal-time mono"
  t.textContent = hhmm(item.meta.at)
  const ti = document.createElement("span")
  ti.className = "cal-title"
  ti.textContent = item.title
  chip.append(t, ti)
  return chip
}

function calSwitch() {
  const bar = document.createElement("div")
  bar.className = "cal-switch"
  for (const r of ["today", "week", "month"]) {
    const btn = document.createElement("button")
    btn.className = "cal-range"
    btn.textContent = r
    btn.setAttribute("aria-current", String(r === calRange))
    btn.addEventListener("click", () => {
      calRange = r
      render()
    })
    bar.append(btn)
  }
  return bar
}

function dayCell(items, day, now, className) {
  const cell = document.createElement("div")
  cell.className = className + (sameDay(day, now) ? " today" : "")
  for (const it of eventsOn(items, day)) cell.append(eventChip(it))
  return cell
}

function weekGridEl(items, now, extra = "") {
  const grid = document.createElement("div")
  grid.className = `cal-week${extra}`
  for (const day of weekDays(now)) {
    const cell = dayCell(items, day, now, "cal-day")
    const h = document.createElement("div")
    h.className = "cal-dayhead"
    h.textContent = `${DOW[day.getDay()]} ${day.getDate()}`
    cell.prepend(h)
    grid.append(cell)
  }
  return grid
}

function renderCalendar(items) {
  const now = new Date()
  const wrap = document.createElement("div")
  wrap.className = "cal"
  wrap.append(calSwitch())
  if (calRange === "today") {
    const col = document.createElement("div")
    col.className = "cal-agenda"
    const evs = eventsOn(items, now)
    if (evs.length === 0) {
      const e = document.createElement("p")
      e.className = "empty-detail"
      e.textContent = "Nothing scheduled today."
      col.append(e)
    }
    for (const it of evs) col.append(eventChip(it))
    wrap.append(col)
  } else if (calRange === "week") {
    wrap.append(weekGridEl(items, now))
  } else {
    const grid = document.createElement("div")
    grid.className = "cal-month"
    for (const d of DOW) {
      const h = document.createElement("div")
      h.className = "cal-dow"
      h.textContent = d
      grid.append(h)
    }
    for (const week of monthGrid(now)) {
      for (const day of week) {
        const off = day.getMonth() !== now.getMonth()
        const cell = dayCell(items, day, now, `cal-cell${off ? " off" : ""}`)
        const n = document.createElement("div")
        n.className = "cal-num"
        n.textContent = String(day.getDate())
        cell.prepend(n)
        grid.append(cell)
      }
    }
    wrap.append(grid)
  }
  detail.append(wrap)
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
  const items = filterByType(itemsFor(model, who), type)
  if (type === "calendar") {
    renderCalendar(items)
    return
  }
  if (type === "All") {
    const cals = items.filter((i) => i.source === "calendar")
    if (cals.length > 0) {
      const sec = document.createElement("div")
      sec.className = "allweek"
      const h = document.createElement("div")
      h.className = "allweek-head"
      h.textContent = "This week"
      sec.append(h, weekGridEl(cals, new Date(), " compact"))
      detail.append(sec)
    }
  }
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
  renderTabs()
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
