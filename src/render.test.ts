import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { onSlots, type DayPlan } from "./model.ts"
import { renderBoardWallpaper, type WallpaperInput } from "./render.ts"

const today: DayPlan = { date: "2026-11-12", status: "applies", slots: onSlots() }
const tomorrow: DayPlan = { date: "2026-11-13", status: "applies", slots: onSlots() }

function card(place: string, queue: string): WallpaperInput {
  return { place, queue, source: "ДТЕК", today, tomorrow, updated: "2026-11-12T03:00:00+02:00" }
}

describe("one screen", () => {
  it("keeps a single queue on the large layout", () => {
    const svg = renderBoardWallpaper([card("Київ", "27.1")], new Date("2026-11-12T10:00:00+02:00"))
    assert.match(svg, /черга 27\.1/)
    assert.equal(svg.match(/<svg/g)?.length, 1)
  })

  it("draws every saved place on one wallpaper", () => {
    const svg = renderBoardWallpaper(
      [card("Київ", "27.1"), card("Чернівці", "3"), card("Бровари", "1.1")],
      new Date("2026-11-12T10:00:00+02:00"),
    )
    assert.match(svg, /Київ · 27\.1/)
    assert.match(svg, /Чернівці · 3/)
    assert.match(svg, /Бровари · 1\.1/)
    assert.equal(svg.match(/<svg/g)?.length, 1)
  })
})
