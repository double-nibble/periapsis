// Pure view helpers for the dashboard. No DOM access, so they are unit-testable.

const byPriority = (a, b) => a.priority - b.priority || a.key.localeCompare(b.key)

// Every reporter's items in one list, sorted, for the fleet-wide "All" view.
export function fleetItems(model) {
  return model.accounts.flatMap((a) => a.items).sort(byPriority)
}

// Items for the chosen sidebar entry: a single account, or the whole fleet.
export function itemsFor(model, who) {
  if (who === "All") return fleetItems(model)
  return model.accounts.find((a) => a.account === who)?.items ?? []
}

export function urgent(items) {
  return items.filter((i) => i.priority === 1).length
}
