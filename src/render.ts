import {
  type DayPlan,
  type Slot,
  SLOT_COUNT,
  formatMin,
  headline,
  kyivNow,
  offRanges,
  onSlots,
  ukDate,
} from "./model.ts"

export const WALLPAPER_WIDTH = 1179
export const WALLPAPER_HEIGHT = 2556

export interface WallpaperInput {
  place: string
  queue: string
  source: string
  today: DayPlan
  tomorrow: DayPlan
  updated: string | null
  now?: Date
}

const INK = "#f4f0e7"
const MUTED = "#9a9286"
const AMBER = "#e2b15a"
const TRACK = "#1c1e24"
const PAPER = "#f3efe4"

export function renderWallpaper(input: WallpaperInput): string {
  const now = kyivNow(input.now ?? new Date())
  const state = headline(input.today, now.minutes)
  const titleSize = input.today.status === "emergency" || state.title.length > 16 ? 68 : 92
  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WALLPAPER_WIDTH}" height="${WALLPAPER_HEIGHT}" viewBox="0 0 ${WALLPAPER_WIDTH} ${WALLPAPER_HEIGHT}">`,
  )
  parts.push(`<rect width="${WALLPAPER_WIDTH}" height="${WALLPAPER_HEIGHT}" fill="#101114"/>`)
  parts.push(
    `<radialGradient id="glow" cx="50%" cy="42%" r="55%"><stop offset="0%" stop-color="#2a241c"/><stop offset="70%" stop-color="#101114" stop-opacity="0"/></radialGradient>`,
  )
  parts.push(`<rect width="${WALLPAPER_WIDTH}" height="${WALLPAPER_HEIGHT}" fill="url(#glow)"/>`)

  let y = 940
  parts.push(text("ЗАРАЗ", 86, y, 22, MUTED, 500, 6))
  y += 92
  parts.push(text(state.title, 86, y, titleSize, toneColor(state.tone), 600))
  y += titleSize > 80 ? 64 : 52
  parts.push(text(state.sub, 86, y, 36, state.tone === "on" ? MUTED : AMBER, 500))
  y += 78
  parts.push(text(`${input.place}  ·  черга ${input.queue}`, 86, y, 28, MUTED, 500))
  y += 92

  if (state.tone !== "alert") {
    y = drawDay(parts, "Сьогодні", input.today, y, true, now.minutes)
    y += 56
    y = drawDay(parts, "Завтра", input.tomorrow, y, false, null)
  } else {
    parts.push(text("Години з планового графіка зараз були б неправдою.", 86, y + 20, 28, MUTED, 400))
  }

  const updated = input.updated ? kyivNow(new Date(input.updated)).hm : null
  const footer = updated ? `${input.source}  ·  оновлено ${updated}` : input.source
  parts.push(text(footer, 86, 2140, 24, "#6f6a62", 400))
  parts.push("</svg>")
  return parts.join("")
}

export function renderBoardWallpaper(items: WallpaperInput[], now?: Date): string {
  if (items.length <= 1 && items[0]) return renderWallpaper({ ...items[0], now })
  return renderMany(items, now ?? new Date())
}

function renderMany(items: WallpaperInput[], nowDate: Date): string {
  const now = kyivNow(nowDate)
  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WALLPAPER_WIDTH}" height="${WALLPAPER_HEIGHT}" viewBox="0 0 ${WALLPAPER_WIDTH} ${WALLPAPER_HEIGHT}">`,
  )
  parts.push(`<rect width="${WALLPAPER_WIDTH}" height="${WALLPAPER_HEIGHT}" fill="#101114"/>`)
  parts.push(
    `<radialGradient id="glow" cx="50%" cy="38%" r="55%"><stop offset="0%" stop-color="#2a241c"/><stop offset="70%" stop-color="#101114" stop-opacity="0"/></radialGradient>`,
  )
  parts.push(`<rect width="${WALLPAPER_WIDTH}" height="${WALLPAPER_HEIGHT}" fill="url(#glow)"/>`)

  const margin = 72
  const gapX = 32
  const gapY = 26
  const top = 960
  const bottom = 2440
  const columns = items.length >= 5 ? 2 : 1
  const rows = Math.ceil(items.length / columns)
  const cardWidth = columns === 1 ? WALLPAPER_WIDTH - margin * 2 : (WALLPAPER_WIDTH - margin * 2 - gapX) / 2
  let cardHeight = items.length <= 2 ? 520 : items.length <= 4 ? 330 : 250
  const available = bottom - top - gapY * (rows - 1)
  if (rows * cardHeight > available) cardHeight = available / rows

  items.forEach((item, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = margin + column * (cardWidth + gapX)
    const y = top + row * (cardHeight + gapY)
    drawCard(parts, item, x, y, cardWidth, cardHeight, now.minutes)
  })

  const sources = [...new Set(items.map((item) => item.source).filter(Boolean))]
  const source = sources.length === 1 ? sources[0]! : "Кілька операторів"
  const stamps = items.map((item) => item.updated).filter((value): value is string => Boolean(value)).sort()
  const updated = stamps.at(-1) ? kyivNow(new Date(stamps.at(-1)!)).hm : null
  const footer = updated ? `${source}  ·  оновлено ${updated}` : source
  parts.push(text(footer, margin, 2508, 22, "#6f6a62", 400))
  parts.push("</svg>")
  return parts.join("")
}

function drawCard(
  parts: string[],
  item: WallpaperInput,
  x: number,
  y: number,
  width: number,
  height: number,
  nowMin: number,
): void {
  const state = headline(item.today, nowMin)
  const narrow = width < 700
  const limit = y + height
  let cursor = y + (narrow ? 28 : 42)
  parts.push(text(fit(`${item.place} · ${item.queue}`, narrow ? 22 : 32), x, cursor, narrow ? 24 : 36, INK, 600))
  cursor += narrow ? 32 : 46
  if (cursor > limit - 16) return
  parts.push(text(fit(state.title, narrow ? 20 : 26), x, cursor, narrow ? 20 : 28, toneColor(state.tone), 600))
  cursor += narrow ? 28 : 36
  if (state.tone !== "alert" && height > (narrow ? 190 : 220) && cursor < limit - 20) {
    parts.push(text(fit(state.sub, narrow ? 30 : 44), x, cursor, narrow ? 16 : 22, state.tone === "on" ? MUTED : AMBER, 500))
    cursor += narrow ? 24 : 30
  }
  if (state.tone === "alert") {
    if (cursor < limit - 16) parts.push(text("Плановий графік зараз не діє.", x, cursor, 20, MUTED, 400))
    return
  }
  cursor += narrow ? 6 : 10
  const showTomorrow = limit - cursor > (narrow ? 88 : 120)
  const bar = Math.min(narrow ? 34 : 58, Math.max(20, (limit - cursor - (showTomorrow ? 64 : 24)) / (showTomorrow ? 2 : 1)))
  if (cursor + bar > limit) return
  cursor = drawCompactDay(parts, "Сьогодні", item.today, cursor, x, width, bar, nowMin, narrow)
  if (!showTomorrow || cursor + 18 > limit) return
  cursor += narrow ? 12 : 18
  drawCompactDay(parts, "Завтра", item.tomorrow, cursor, x, width, Math.max(18, bar - 8), null, narrow)
}

function drawCompactDay(
  parts: string[],
  label: string,
  day: DayPlan,
  y: number,
  x: number,
  width: number,
  bar: number,
  nowMin: number | null,
  narrow: boolean,
): number {
  const labelSize = narrow ? 14 : 18
  parts.push(text(label.toUpperCase(), x, y, labelSize, MUTED, 500, narrow ? 1.2 : 2.4))
  if (!narrow && day.date) parts.push(text(ukDate(day.date), x + 148, y, labelSize, "#6f6a62", 400))
  y += narrow ? 12 : 16
  const showBar = (day.status === "applies" || day.status === "none") && day.slots.length === SLOT_COUNT
  if (!showBar) {
    const message = day.status === "emergency"
      ? "Аварійні відключення"
      : day.status === "none"
        ? "Відключень немає"
        : "Графік ще не опубліковано"
    parts.push(text(message, x, y + 20, narrow ? 16 : 22, MUTED, 400))
    return y + (narrow ? 36 : 48)
  }
  parts.push(track(day.slots, x, y, width, bar, nowMin))
  y += bar + (narrow ? 16 : 22)
  parts.push(hourLabels(x, y, width, narrow ? [0, 12] : [0, 6, 12, 18]))
  return y + (narrow ? 14 : 18)
}

function fit(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(1, max - 1))}…`
}

function drawDay(
  parts: string[],
  label: string,
  day: DayPlan,
  y: number,
  primary: boolean,
  nowMin: number | null,
): number {
  parts.push(text(label.toUpperCase(), 86, y, 20, MUTED, 500, 3.5))
  parts.push(text(ukDate(day.date), 250, y, 20, "#6f6a62", 400))
  y += 28
  const showBar = day.status === "applies" || day.status === "none"
  if (!showBar) {
    const message =
      day.status === "emergency"
        ? "Аварійні відключення, плановий графік не діє"
        : day.status === "none"
          ? "Відключень немає"
          : "Графік ще не опубліковано"
    parts.push(text(message, 86, y + 36, 28, MUTED, 400))
    return y + 72
  }
  const slots = day.slots.length === SLOT_COUNT ? day.slots : onSlots()
  const height = primary ? 70 : 48
  parts.push(track(slots, 86, y, WALLPAPER_WIDTH - 172, height, nowMin))
  y += height + 34
  parts.push(hourLabels(86, y, WALLPAPER_WIDTH - 172))
  y += 36
  const off = offRanges(slots, 1)
  const maybe = offRanges(slots, 2)
  const summary = [off ? `немає ${off}` : "", maybe ? `можливо ${maybe}` : ""].filter(Boolean).join("   ")
  if (summary) {
    for (const line of wrap(summary, 46).slice(0, 2)) {
      parts.push(text(line, 86, y, 24, MUTED, 400))
      y += 34
    }
  }
  return y
}

function track(slots: Slot[], x: number, y: number, width: number, height: number, nowMin: number | null): string {
  const gap = 4
  const halfGap = 2
  const hourWidth = (width - gap * 23) / 24
  const halfWidth = (hourWidth - halfGap) / 2
  const marks: string[] = [
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="16" fill="${TRACK}"/>`,
  ]
  for (let hour = 0; hour < 24; hour += 1) {
    for (let half = 0; half < 2; half += 1) {
      const value = slots[hour * 2 + half] ?? 0
      if (value === 1) continue
      const left = x + hour * (hourWidth + gap) + half * (halfWidth + halfGap)
      const fill = value === 2 ? AMBER : PAPER
      const opacity = value === 2 ? 0.8 : 1
      marks.push(
        `<rect x="${left.toFixed(2)}" y="${y + 5}" width="${halfWidth.toFixed(2)}" height="${height - 10}" rx="4" fill="${fill}" opacity="${opacity}"/>`,
      )
    }
  }
  if (nowMin != null) {
    const hour = Math.min(23, Math.floor(nowMin / 60))
    const within = (nowMin - hour * 60) / 60
    const left = x + hour * (hourWidth + gap) + within * hourWidth
    marks.push(`<rect x="${(left - 3).toFixed(2)}" y="${y - 10}" width="6" height="${height + 20}" rx="3" fill="#101114"/>`)
    marks.push(`<rect x="${(left - 1.25).toFixed(2)}" y="${y - 10}" width="2.5" height="${height + 20}" rx="1.2" fill="${INK}"/>`)
  }
  return marks.join("")
}

function hourLabels(x: number, y: number, width: number, hours: readonly number[] = [0, 6, 12, 18]): string {
  const gap = 4
  const hourWidth = (width - gap * 23) / 24
  return hours
    .map((hour) => {
      const center = x + hour * (hourWidth + gap) + hourWidth / 2
      return text(String(hour).padStart(2, "0"), center - 14, y, 18, "#6f6a62", 500)
    })
    .join("")
}

function wrap(value: string, size: number): string[] {
  const words = value.split(" ")
  const lines: string[] = []
  let line = ""
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length > size && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

function toneColor(tone: "on" | "off" | "maybe" | "wait" | "alert"): string {
  if (tone === "off" || tone === "alert") return "#f2d7a2"
  if (tone === "maybe") return AMBER
  return INK
}

function text(
  value: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  weight: number,
  spacing = 0,
): string {
  const letter = spacing ? ` letter-spacing="${spacing}"` : ""
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="Noto Sans" font-size="${size}" font-weight="${weight}"${letter}>${escapeXml(value)}</text>`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
