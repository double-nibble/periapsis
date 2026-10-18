import {
  MIN_EVENT_MINUTES,
  accountColors,
  allDayLanes,
  eventSpan,
  eventsOn,
  filterByType,
  hourRange,
  itemsFor,
  monthGrid,
  presentTypes,
  sameDay,
  timedSegments,
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
let colors = {}

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
  if (label !== "All") {
    const swatch = document.createElement("span")
    swatch.className = `swatch acct-c${colors[label] ?? 0}`
    name.append(swatch)
  }
  name.append(label)
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
  // Counts are of things that need attention; calendar events are not.
  const tally = (items) => items.filter((i) => i.source !== "calendar")
  roster.append(rosterButton("All", tally(itemsFor(model, "All"))))
  for (const acct of model.accounts) roster.append(rosterButton(acct.account, tally(acct.items)))
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
    acct.className = `who-tag mono acct-c${colors[item.account] ?? 0}`
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

function hhmm(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

function colorClass(item) {
  return `acct-c${colors[item.account] ?? 0}`
}

function linkOrBlock(item, className) {
  const el = document.createElement(item.url ? "a" : "div")
  el.className = className
  if (item.url) {
    el.href = item.url
    el.target = "_blank"
    el.rel = "noreferrer"
  }
  return el
}

function eventChip(item) {
  const chip = linkOrBlock(item, `cal-ev ${colorClass(item)}`)
  const span = eventSpan(item)
  if (span && !span.allDay) {
    const t = document.createElement("span")
    t.className = "cal-time mono"
    t.textContent = hhmm(span.start)
    chip.append(t)
  }
  const ti = document.createElement("span")
  ti.className = "cal-title"
  ti.textContent = item.title
  chip.append(ti)
  chip.title = `${item.title} · ${item.account}`
  return chip
}

// A Google Calendar style grid: day headers, an all-day strip, then a time
// axis with each timed event sized by its length and overlaps side by side.
function timeGridEl(items, days, now, compact = false) {
  const hour = compact ? 22 : 44
  const segsByDay = days.map((d) => timedSegments(items, d))
  const { from, to } = hourRange(segsByDay.flat())
  const px = (minutes) => ((minutes - from * 60) / 60) * hour
  const grid = document.createElement("div")
  grid.className = `tg${compact ? " compact" : ""}`
  grid.style.setProperty("--days", String(days.length))
  grid.style.setProperty("--hour", `${hour}px`)

  const head = document.createElement("div")
  head.className = "tg-row tg-head"
  head.append(document.createElement("div"))
  for (const day of days) {
    const h = document.createElement("div")
    h.className = `tg-day${sameDay(day, now) ? " today" : ""}`
    const dow = document.createElement("span")
    dow.className = "tg-dow"
    dow.textContent = DOW[day.getDay()]
    const num = document.createElement("span")
    num.className = "tg-num"
    num.textContent = String(day.getDate())
    h.append(dow, num)
    head.append(h)
  }
  grid.append(head)

  const lanes = allDayLanes(items, days)
  if (lanes.length > 0) {
    const strip = document.createElement("div")
    strip.className = "tg-row tg-allday"
    const label = document.createElement("div")
    label.className = "tg-axis-label"
    label.textContent = compact ? "" : "all day"
    label.style.gridRow = `1 / span ${Math.max(...lanes.map((l) => l.lane)) + 1}`
    strip.append(label)
    for (const l of lanes) {
      const cut = `${l.before ? " before" : ""}${l.after ? " after" : ""}`
      const bar = linkOrBlock(l.item, `tg-allday-ev ${colorClass(l.item)}${cut}`)
      bar.style.gridColumn = `${l.from + 2} / ${l.to + 2}`
      bar.style.gridRow = String(l.lane + 1)
      bar.textContent = l.item.title
      bar.title = `${l.item.title} · ${l.item.account}`
      strip.append(bar)
    }
    grid.append(strip)
  }

  const body = document.createElement("div")
  body.className = "tg-row tg-body"
  body.style.height = `${(to - from) * hour}px`
  const axis = document.createElement("div")
  axis.className = "tg-axis"
  for (let h = from + 1; h < to; h++) {
    const t = document.createElement("span")
    t.className = "tg-hour"
    t.style.top = `${(h - from) * hour}px`
    t.textContent = `${String(h).padStart(2, "0")}:00`
    axis.append(t)
  }
  body.append(axis)
  days.forEach((day, i) => {
    const col = document.createElement("div")
    col.className = `tg-col${sameDay(day, now) ? " today" : ""}`
    for (const s of segsByDay[i]) {
      const span = eventSpan(s.item)
      const when = `${hhmm(span.start)} – ${hhmm(span.end)}`
      const ev = linkOrBlock(s.item, `tg-ev ${colorClass(s.item)}`)
      ev.style.top = `${px(s.startMin)}px`
      ev.style.height = `${(Math.max(s.endMin - s.startMin, MIN_EVENT_MINUTES) / 60) * hour - 2}px`
      ev.style.left = `calc(${(s.col / s.cols) * 100}% + 1px)`
      ev.style.width = `calc(${100 / s.cols}% - 3px)`
      const title = document.createElement("span")
      title.className = "tg-ev-title"
      title.textContent = s.item.title
      ev.append(title)
      if (!compact) {
        const time = document.createElement("span")
        time.className = "tg-ev-time"
        time.textContent = when
        ev.append(time)
      }
      ev.title = `${s.item.title}\n${when} · ${s.item.account}`
      col.append(ev)
    }
    const minute = now.getHours() * 60 + now.getMinutes()
    if (sameDay(day, now) && minute >= from * 60 && minute <= to * 60) {
      const line = document.createElement("div")
      line.className = "tg-now"
      line.style.top = `${px(minute)}px`
      col.append(line)
    }
    body.append(col)
  })
  grid.append(body)
  return grid
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

function renderCalendar(items) {
  const now = new Date()
  const wrap = document.createElement("div")
  wrap.className = "cal"
  wrap.append(calSwitch())
  if (calRange === "today") {
    wrap.append(timeGridEl(items, [now], now))
  } else if (calRange === "week") {
    wrap.append(timeGridEl(items, weekDays(now), now))
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
      sec.append(h, timeGridEl(cals, weekDays(new Date()), new Date(), true))
      detail.append(sec)
    }
  }
  // On the All tab the week grid shows the calendar, so the list leaves it out.
  const listed = type === "All" ? items.filter((i) => i.source !== "calendar") : items
  const bySource = new Map()
  for (const item of listed) {
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
  colors = accountColors(model.accounts.map((a) => a.account))
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
