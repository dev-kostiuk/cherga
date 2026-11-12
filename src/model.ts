export type Slot = 0 | 1 | 2
export type DayStatus = "applies" | "none" | "waiting" | "emergency" | "unavailable"

export interface DayPlan {
  date: string
  status: DayStatus
  slots: Slot[]
}

export interface QueuePlan {
  queue: string
  updated: string | null
  today: DayPlan
  tomorrow: DayPlan
}

export interface OperatorPlan {
  id: string
  name: string
  short: string
  oblast: string
  oblastSlug: string
  sourceName: string
  sourceUrl: string
  fetchedAt: string | null
  ok: boolean
  error: string | null
  note: string | null
  queues: QueuePlan[]
}

export interface Snapshot {
  generatedAt: string
  operators: OperatorPlan[]
}

export const SLOT_COUNT = 48

export const QUEUE_PAIRS = Array.from({ length: 6 }, (_, queue) =>
  [1, 2].map((sub) => `${queue + 1}.${sub}`),
).flat()

const MONTHS = [
  "січня",
  "лютого",
  "березня",
  "квітня",
  "травня",
  "червня",
  "липня",
  "серпня",
  "вересня",
  "жовтня",
  "листопада",
  "грудня",
]

export const MONTH_INDEX: Record<string, number> = Object.fromEntries(MONTHS.map((name, index) => [name, index + 1]))

export function onSlots(): Slot[] {
  return Array.from({ length: SLOT_COUNT }, () => 0 as Slot)
}

export function paint(slots: Slot[], startMin: number, endMin: number, value: Slot): void {
  const start = clampMinute(startMin)
  let end = clampMinute(endMin)
  if (end <= start) end = 1440
  for (let index = 0; index < SLOT_COUNT; index += 1) {
    const slotStart = index * 30
    const overlap = Math.min(end, slotStart + 30) - Math.max(start, slotStart)
    if (overlap <= 0) continue
    const current = slots[index] ?? 0
    if (value === 1 || current !== 1) slots[index] = value
  }
}

function clampMinute(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1440, value))
}

export function clockToMin(clock: string): number {
  const match = clock.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return 0
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour === 24 && minute === 0) return 1440
  return hour * 60 + minute
}

export function formatMin(min: number): string {
  if (min >= 1440) return "24:00"
  const hour = Math.floor(min / 60)
  const minute = min % 60
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

export function slotIndex(minutes: number): number {
  return Math.min(SLOT_COUNT - 1, Math.max(0, Math.floor(minutes / 30)))
}

export interface KyivNow {
  date: string
  minutes: number
  hm: string
}

export function kyivNow(date: Date): KyivNow {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Kyiv",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
  let hour = Number(parts.hour)
  const minute = Number(parts.minute)
  if (hour === 24) hour = 0
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + minute,
    hm: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  }
}

export function addIsoDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number)
  const next = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days))
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(next.getUTCDate()).padStart(2, "0")
  return `${next.getUTCFullYear()}-${mm}-${dd}`
}

export function ukDate(iso: string): string {
  const [, month, day] = iso.split("-")
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ""}`.trim()
}

export function dmyToIso(value: string, yearHint?: number): string | null {
  const match = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!match) return null
  const year = yearHint ?? Number(match[3])
  return `${year}-${match[2]}-${match[1]}`
}

export function kyivStamp(value: string): string | null {
  const match = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/)
  if (!match) return null
  return `${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:00+02:00`
}

export function compareQueues(a: string, b: string): number {
  const left = a.split(".").map(Number)
  const right = b.split(".").map(Number)
  return (left[0]! - right[0]!) || ((left[1] ?? 0) - (right[1] ?? 0)) || a.localeCompare(b, "uk")
}

export interface Headline {
  title: string
  sub: string
  tone: "on" | "off" | "maybe" | "wait" | "alert"
}

export function headline(day: DayPlan, minutes: number): Headline {
  if (day.status === "emergency") {
    return { title: "Аварійні відключення", sub: "Плановий графік зараз не діє", tone: "alert" }
  }
  if (day.status === "unavailable") {
    return { title: "Немає даних", sub: "Графік тимчасово недоступний", tone: "wait" }
  }
  if (day.status === "waiting" || day.slots.length !== SLOT_COUNT) {
    return { title: "Графіка ще немає", sub: "На сьогодні його не опубліковано", tone: "wait" }
  }
  if (day.status === "none") {
    return { title: "Відключень немає", sub: "Світло сьогодні за графіком є", tone: "on" }
  }
  const slots = day.slots
  const index = slotIndex(minutes)
  const state = slots[index] ?? 0
  const nextOn = findNext(slots, index, (slot) => slot === 0)
  const nextOff = findNext(slots, index, (slot) => slot !== 0)
  if (state === 0) {
    return {
      title: "Світло є",
      sub: nextOff == null ? "до кінця дня" : `вимкнуть о ${formatMin(nextOff * 30)}`,
      tone: "on",
    }
  }
  if (state === 2) {
    return {
      title: "Можливо немає",
      sub: nextOn == null ? "до кінця дня" : `орієнтовно до ${formatMin(nextOn * 30)}`,
      tone: "maybe",
    }
  }
  return {
    title: "Світла немає",
    sub: nextOn == null ? "до кінця дня" : `увімкнуть о ${formatMin(nextOn * 30)}`,
    tone: "off",
  }
}

function findNext(slots: Slot[], from: number, pred: (slot: Slot) => boolean): number | null {
  for (let index = from + 1; index < slots.length; index += 1) {
    if (pred(slots[index] ?? 0)) return index
  }
  return null
}

export function offRanges(slots: Slot[], value: Slot): string {
  const parts: string[] = []
  let start: number | null = null
  for (let index = 0; index <= slots.length; index += 1) {
    const active = index < slots.length && slots[index] === value
    if (active && start == null) start = index
    if (!active && start != null) {
      parts.push(`${formatMin(start * 30)}–${formatMin(index * 30)}`)
      start = null
    }
  }
  return parts.join(", ")
}

export function queuePlan(
  queue: string,
  today: DayPlan,
  tomorrow: DayPlan,
  updated: string | null,
): QueuePlan {
  return { queue, updated, today, tomorrow }
}

export function emptyDay(date: string, status: DayStatus): DayPlan {
  if (status === "none") return { date, status, slots: onSlots() }
  return { date, status, slots: [] }
}

export function appliesDay(date: string, slots: Slot[]): DayPlan {
  return { date, status: "applies", slots }
}
