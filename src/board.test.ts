import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { addEntry, entryKey, groupEntries, normalizeStored, removeEntry, sameArea, type Entry } from "./board.ts"

const brovary: Entry = {
  operatorId: "kyiv-region",
  queue: "1.1",
  label: "Бровари",
  detail: "місто",
  oblastSlug: "kyiv-region",
  oblastName: "Київська область",
}

const home: Entry = { ...brovary, queue: "1.2" }
const kyiv: Entry = {
  operatorId: "kyiv",
  queue: "27.1",
  label: "Київ",
  detail: "місто",
  oblastSlug: "kyiv-city",
  oblastName: "м. Київ",
}

describe("board", () => {
  it("adds several places and queues and keeps one focus", () => {
    let board = addEntry({ entries: [], focus: null }, brovary)
    board = addEntry(board, home)
    board = addEntry(board, kyiv)
    assert.equal(board.entries.length, 3)
    assert.equal(board.focus, entryKey(kyiv))
    board = addEntry(board, home)
    assert.equal(board.entries.length, 3)
    assert.equal(board.focus, entryKey(home))
  })

  it("groups a second queue under the same city", () => {
    const groups = groupEntries([brovary, kyiv, home])
    assert.deepEqual(groups.map((group) => group.label), ["Бровари", "Київ"])
    assert.deepEqual(groups[0]!.entries.map((entry) => entry.queue), ["1.1", "1.2"])
  })

  it("focuses a neighbor after removal", () => {
    const board = addEntry(addEntry({ entries: [], focus: null }, brovary), home)
    const next = removeEntry(board, entryKey(home))
    assert.equal(next.entries.length, 1)
    assert.equal(next.focus, entryKey(brovary))
    assert.equal(removeEntry(next, entryKey(brovary)).focus, null)
  })

  it("reads the previous single selection", () => {
    const board = normalizeStored(brovary)
    assert.equal(board.entries.length, 1)
    assert.equal(board.focus, entryKey(brovary))
    assert.equal(sameArea("Київ", "м. Київ"), true)
    assert.equal(sameArea("Бровари", "Київська область"), false)
  })
})