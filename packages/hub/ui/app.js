const roster = document.getElementById("roster")
const detail = document.getElementById("detail")
const schedule = document.getElementById("schedule")

let model = { accounts: [], schedule: [] }
let selected = null

function urgentCount(items) {
  return items.filter((i) => i.priority === 1).length
}

function renderRoster() {
  roster.replaceChildren()
  for (const acct of model.accounts) {
    const btn = document.createElement("button")
    btn.className = "acct"
    btn.setAttribute("aria-current", String(acct.account === selected))
    const u = urgentCount(acct.items)
    const name = document.createElement("span")
    name.className = "name"
    name.textContent = acct.account
    const count = document.createElement("span")
    count.className = u > 0 ? "count urgent mono" : "count mono"
    count.textContent = u > 0 ? `${acct.items.length} · ${u}!` : String(acct.items.length)
    btn.append(name, count)
    btn.addEventListener("click", () => {
      selected = acct.account
      render()
    })
    roster.append(btn)
  }
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
    const who = document.createElement("span")
    who.className = "who"
    who.textContent = s.account
    slot.append(time, ev, who)
    schedule.append(slot)
  }
}

function renderDetail() {
  detail.replaceChildren()
  const acct = model.accounts.find((a) => a.account === selected)
  if (!acct) {
    const p = document.createElement("p")
    p.className = "empty-detail"
    p.textContent = "Select an account to see what it needs."
    detail.append(p)
    return
  }
  const bySource = new Map()
  for (const item of acct.items) {
    const list = bySource.get(item.source) ?? []
    list.push(item)
    bySource.set(item.source, list)
  }
  for (const [source, items] of bySource) {
    const group = document.createElement("div")
    group.className = "srcgroup"
    const head = document.createElement("div")
    head.className = "srchead"
    const label = document.createElement("span")
    label.textContent = source
    const inst = document.createElement("span")
    inst.className = "inst"
    inst.textContent = [...new Set(items.map((i) => i.meta.instance).filter(Boolean))].join(" / ")
    head.append(label, inst)
    group.append(head)
    for (const item of items) {
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
      const kind = document.createElement("div")
      kind.className = "kind"
      kind.textContent = item.kind
      row.append(bar, mid, kind)
      group.append(row)
    }
    detail.append(group)
  }
}

function render() {
  if (!selected && model.accounts.length) selected = model.accounts[0].account
  renderSchedule()
  renderRoster()
  renderDetail()
}

const es = new EventSource("/api/events")
es.addEventListener("model", (e) => {
  model = JSON.parse(e.data)
  render()
})
