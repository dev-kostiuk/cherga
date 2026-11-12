import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { appliesDay, headline, offRanges, onSlots, paint } from "./model.ts"
import { dtekHoursToSlots, parseChernivtsi, parseQueueIntervals, telegramMessages, titleDate } from "./parse.ts"

describe("slots", () => {
  it("paints an outage and names the return time", () => {
    const slots = onSlots()
    paint(slots, 120, 240, 1)
    const day = appliesDay("2026-11-12", slots)
    assert.equal(headline(day, 150).title, "Світла немає")
    assert.equal(headline(day, 150).sub, "увімкнуть о 04:00")
    assert.equal(headline(day, 300).title, "Світло є")
    assert.equal(headline(day, 300).sub, "до кінця дня")
    assert.equal(offRanges(slots, 1), "02:00–04:00")
  })

  it("reads a queue written with a colon or whole hours", () => {
    const colon = parseQueueIntervals("1.1: 13:00 - 18:00 1.2: 05:30 - 09:00")
    assert.deepEqual(colon.get("1.1"), [[780, 1080]])
    const hours = parseQueueIntervals("Черга 1.1: 06-08, 10-12, 22-24")
    assert.deepEqual(hours.get("1.1"), [
      [360, 480],
      [600, 720],
      [1320, 1440],
    ])
  })

  it("reads DTEK half hours", () => {
    const slots = dtekHoursToSlots({ 1: "yes", 15: "first", 21: "second" })
    assert.equal(slots[0], 0)
    assert.equal(slots[28], 1)
    assert.equal(slots[29], 0)
    assert.equal(slots[40], 0)
    assert.equal(slots[41], 1)
  })
})

describe("text schedules", () => {
  it("parses Cherkasy times with broken spaces", () => {
    const found = parseQueueIntervals(
      "1.1  04 :00 - 06:00 , 09 :00 - 11:00 1.2  05 :00 - 07:00 6.2  14 :00 - 17:0 0",
    )
    assert.deepEqual(found.get("1.1"), [
      [240, 360],
      [540, 660],
    ])
    assert.deepEqual(found.get("6.2"), [[840, 1020]])
  })

  it("reads a Kharkiv line", () => {
    const found = parseQueueIntervals("1.1 02:30-06:00; 09:30-16:30 1.2 02:30-06:00")
    assert.deepEqual(found.get("1.1"), [
      [150, 360],
      [570, 990],
    ])
  })

  it("takes the day from the title", () => {
    assert.equal(titleDate("Графік погодинних відключень (ГПВ) на 12 листопада", "2026-11-11T21:13:00"), "2026-11-12")
  })

  it("reads the Chernivtsi grid and a Telegram post", () => {
    const cells = Array.from({ length: 48 }, (_, index) => (index < 4 ? "<o>в</o>" : index === 4 ? "<s>мз</s>" : "<u>з</u>")).join("")
    const parsed = parseChernivtsi(`<p>12.11.2026</p><div id="inf3" data-id="3">${cells}</div>`)
    assert.equal(parsed.date, "2026-11-12")
    assert.equal(parsed.groups.get("3")?.[0], 1)
    assert.equal(parsed.groups.get("3")?.[4], 2)
    assert.equal(parsed.groups.get("3")?.[5], 0)
    const messages = telegramMessages(
      `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message_text">Черга 1.1: 06-08</div><time datetime="2026-11-12T01:00:00+00:00"></time></div>`,
    )
    assert.equal(messages[0]?.at, "2026-11-12T01:00:00+00:00")
    assert.match(messages[0]?.text ?? "", /1\.1/)
  })
})
