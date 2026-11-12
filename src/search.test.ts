import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { searchPlaces, type PlacesFile } from "./search.ts"

const places: PlacesFile = {
  oblasts: [
    { slug: "kyiv-city", name: "м. Київ" },
    { slug: "kyiv", name: "Київська область" },
    { slug: "lviv", name: "Львівська область" },
  ],
  raions: ["", "Броварський район", "Львівський район"],
  hromadas: ["", "Броварська", "Львівська"],
  places: [
    ["Київ", 0, 0, 0, "м"],
    ["Бровари", 1, 1, 1, "м"],
    ["Львів", 2, 2, 2, "м"],
  ],
}

describe("search", () => {
  it("puts the city before the oblast", () => {
    const hits = searchPlaces(places, "Київ")
    assert.equal(hits[0]?.label, "Київ")
    assert.equal(hits[0]?.oblastSlug, "kyiv-city")
    assert.ok(hits.some((hit) => hit.oblastSlug === "kyiv" && hit.detail === "уся область"))
  })

  it("finds a town in its oblast", () => {
    const hits = searchPlaces(places, "Бровари")
    assert.equal(hits[0]?.oblastSlug, "kyiv")
    assert.match(hits[0]?.detail ?? "", /місто/)
  })
})
