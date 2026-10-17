import assert from "node:assert/strict"
import { test } from "node:test"
import { fleetItems, itemsFor, urgent } from "./view.js"

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
