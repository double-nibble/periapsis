import assert from "node:assert/strict"
import { test } from "node:test"
import { TYPE_ORDER, filterByType, fleetItems, itemsFor, presentTypes, urgent } from "./view.js"

const model = {
  accounts: [
    {
      account: "sub1",
      items: [
        { key: "a", account: "sub1", priority: 2 },
        { key: "b", account: "sub1", priority: 1 },
      ],
    },
    { account: "sub2", items: [{ key: "c", account: "sub2", priority: 1 }] },
  ],
}

test("fleetItems flattens every account and sorts by priority then key", () => {
  assert.deepEqual(
    fleetItems(model).map((i) => i.key),
    ["b", "c", "a"],
  )
})

test("itemsFor returns one account's items, or the fleet for All", () => {
  assert.deepEqual(
    itemsFor(model, "sub2").map((i) => i.key),
    ["c"],
  )
  assert.equal(itemsFor(model, "All").length, 3)
  assert.deepEqual(itemsFor(model, "missing"), [])
})

test("urgent counts priority-1 items", () => {
  assert.equal(urgent(fleetItems(model)), 2)
})

const mixed = [
  { key: "a", source: "code", priority: 1 },
  { key: "b", source: "messages", priority: 2 },
  { key: "c", source: "code", priority: 2 },
  { key: "d", source: "doorbell", priority: 3 },
]

test("presentTypes keeps the canonical order and appends unknowns alphabetically", () => {
  assert.deepEqual(presentTypes(mixed), ["code", "messages", "doorbell"])
  assert.ok(TYPE_ORDER.includes("calendar"))
})

test("filterByType narrows to one source, All keeps everything", () => {
  assert.deepEqual(
    filterByType(mixed, "code").map((i) => i.key),
    ["a", "c"],
  )
  assert.equal(filterByType(mixed, "All").length, 4)
})
