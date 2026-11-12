import {
  type DayPlan,
  type Slot,
  MONTH_INDEX,
  QUEUE_PAIRS,
  addIsoDays,
  appliesDay,
  clockToMin,
  dmyToIso,
  emptyDay,
  kyivNow,
  kyivStamp,
  onSlots,
  paint,
  queuePlan,
  type QueuePlan,
} from "./model.ts"

export function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\u00a0/g, " ")
}

export function normalizeScheduleText(input: string): string {
  let text = stripHtml(input).replace(/[–—−]/g, "-")
  const cut = text.search(/для промисловості|графіки обмеження потужності|\bГОП\b/i)
  if (cut > 40) text = text.slice(0, cut)
  text = text.replace(/(\d)\s*:\s*(\d)/g, "$1:$2")
  text = text.replace(/:(\d)\s+(\d{1,2})(?!\d)/g, ":$1$2")
  return text.replace(/[ \t]+/g, " ")
}

export function parseQueueIntervals(input: string): Map<string, Array<[number, number]>> {
  const text = normalizeScheduleText(input)
  const found = new Map<string, Array<[number, number]>>()
  const queues = /(\d{1,2}\.\d)\s*:?\s*((?:(?:\d{1,2}:\d{2}|\d{1,2})\s*-\s*(?:\d{1,2}:\d{2}|\d{1,2})\s*[;,.]?\s*)+)/g
  for (const match of text.matchAll(queues)) {
    const ranges: Array<[number, number]> = []
    for (const time of match[2]!.matchAll(/(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)/g)) {
      ranges.push([clockToMin(time[1]!), clockToMin(time[2]!)])
    }
    if (ranges.length > 0) found.set(match[1]!, ranges)
  }
  return found
}

export function slotsFromRanges(ranges: Array<[number, number]>, value: Slot = 1): Slot[] {
  const slots = onSlots()
  for (const [start, end] of ranges) paint(slots, start, end, value)
  return slots
}

export function titleDate(title: string, publishedAt: string): string | null {
  const match = title.toLowerCase().match(/(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)/)
  if (!match) return null
  const month = MONTH_INDEX[match[2]!]
  if (!month) return null
  const published = publishedAt.slice(0, 10)
  const publishedMonth = Number(published.slice(5, 7))
  let year = Number(published.slice(0, 4))
  if (!Number.isFinite(year)) year = Number(kyivNow(new Date()).date.slice(0, 4))
  if (month === 1 && publishedMonth === 12) year += 1
  const day = String(Number(match[1])).padStart(2, "0")
  const mm = String(month).padStart(2, "0")
  return `${year}-${mm}-${day}`
}

export function plansFromDays(
  days: Map<string, Map<string, Array<[number, number]>>>,
  today: string,
  tomorrow: string,
  updated: string | null,
): QueuePlan[] {
  const names = new Set<string>()
  for (const queues of days.values()) for (const name of queues.keys()) names.add(name)
  if (names.size < 8) return []
  const list = [...names].some((name) => !QUEUE_PAIRS.includes(name)) ? [...names] : QUEUE_PAIRS
  return list.map((queue) => {
    const todayRanges = days.get(today)?.get(queue)
    const tomorrowRanges = days.get(tomorrow)?.get(queue)
    return queuePlan(
      queue,
      todayRanges
        ? appliesDay(today, slotsFromRanges(todayRanges))
        : emptyDay(today, days.has(today) ? "none" : "waiting"),
      tomorrowRanges
        ? appliesDay(tomorrow, slotsFromRanges(tomorrowRanges))
        : emptyDay(tomorrow, days.has(tomorrow) ? "none" : "waiting"),
      updated,
    )
  })
}

export function dtekHoursToSlots(hours: Record<string, string> | undefined): Slot[] {
  const slots = onSlots()
  if (!hours) return slots
  for (let hour = 1; hour <= 24; hour += 1) {
    const raw = String(hours[String(hour)] ?? "yes").toLowerCase()
    const base = (hour - 1) * 2
    const set = (half: number, value: Slot) => {
      slots[base + half] = value
    }
    if (raw === "no") {
      set(0, 1)
      set(1, 1)
    } else if (raw === "first") {
      set(0, 1)
    } else if (raw === "second") {
      set(1, 1)
    } else if (raw === "maybe") {
      set(0, 2)
      set(1, 2)
    } else if (raw === "mfirst") {
      set(0, 2)
    } else if (raw === "msecond") {
      set(1, 2)
    }
  }
  return slots
}

interface DtekFact {
  data?: Record<string, Record<string, Record<string, string>>> | unknown[]
  update?: string
  today?: number
}

export function parseDtekFact(fact: DtekFact, today: string, tomorrow: string): QueuePlan[] {
  const data = fact.data
  if (!data || Array.isArray(data)) return []
  const byQueue = new Map<string, { today?: Slot[]; tomorrow?: Slot[] }>()
  for (const [stamp, groups] of Object.entries(data)) {
    const date = kyivNow(new Date(Number(stamp) * 1000)).date
    if (date !== today && date !== tomorrow) continue
    for (const [name, hours] of Object.entries(groups)) {
      const queue = name.replace(/^GPV/i, "")
      const bucket = byQueue.get(queue) ?? {}
      const slots = dtekHoursToSlots(hours)
      if (date === today) bucket.today = slots
      if (date === tomorrow) bucket.tomorrow = slots
      byQueue.set(queue, bucket)
    }
  }
  const updated = fact.update ? kyivStamp(fact.update) : null
  return [...byQueue.entries()].map(([queue, days]) =>
    queuePlan(
      queue,
      days.today ? appliesDay(today, days.today) : emptyDay(today, "waiting"),
      days.tomorrow ? appliesDay(tomorrow, days.tomorrow) : emptyDay(tomorrow, "waiting"),
      updated,
    ),
  )
}

export interface YasnoSlot {
  start: number
  end: number
  type: string
}

export interface YasnoDay {
  slots?: YasnoSlot[]
  status?: string
  date?: string
}

export function yasnoStatus(status: string | undefined): DayPlan["status"] {
  if (status === "ScheduleApplies") return "applies"
  if (status === "NoOutages" || status === "NoShutdowns") return "none"
  if (status === "EmergencyShutdowns") return "emergency"
  if (status === "WaitingForSchedule") return "waiting"
  return "unavailable"
}

export function parseYasnoDay(day: YasnoDay | undefined, fallbackDate: string): DayPlan {
  const date = day?.date?.slice(0, 10) || fallbackDate
  const status = yasnoStatus(day?.status)
  if (status === "none") return emptyDay(date, "none")
  if (status !== "applies") return emptyDay(date, status)
  const slots = onSlots()
  for (const slot of day?.slots ?? []) {
    const value: Slot = slot.type === "Definite" ? 1 : slot.type === "Probable" ? 2 : 0
    if (value !== 0) paint(slots, slot.start, slot.end, value)
  }
  return appliesDay(date, slots)
}

export function parseZhytomyr(html: string, today: string, tomorrow: string): QueuePlan[] {
  const updatedMatch = html.match(/Дата оновлення інформації\s*-\s*(\d{2}:\d{2})\s+(\d{2}\.\d{2}\.\d{4})/)
  const updated = updatedMatch ? kyivStamp(`${updatedMatch[2]} ${updatedMatch[1]}`) : null
  const parts = html.split(/colspan="48"><b[^>]*>(\d{2}\.\d{2}\.\d{4})<\/b>/)
  const byDate = new Map<string, Map<string, Slot[]>>()
  for (let index = 1; index < parts.length; index += 2) {
    const iso = dmyToIso(parts[index] ?? "")
    if (!iso) continue
    const rows = parts[index + 1]?.match(/<tr[\s\S]*?<\/tr>/g) ?? []
    const queues = new Map<string, Slot[]>()
    for (const row of rows) {
      const colors = [...row.matchAll(/background:\s*(#[0-9a-fA-F]{6})/g)].map((match) => match[1]!.toLowerCase())
      if (colors.length < 48) continue
      const text = stripHtml(row)
      const queue = text.match(/(\d\.\d)/)?.[1]
      if (!queue) continue
      queues.set(
        queue,
        colors.slice(0, 48).map((color) => (color === "#ff3333" ? 1 : color === "#ffffff" ? 0 : 2)),
      )
    }
    if (queues.size > 0) byDate.set(iso, queues)
  }
  const names = new Set<string>()
  for (const queues of byDate.values()) for (const name of queues.keys()) names.add(name)
  if (names.size < 8) return []
  return [...names].map((queue) => {
    const todaySlots = byDate.get(today)?.get(queue)
    const tomorrowSlots = byDate.get(tomorrow)?.get(queue)
    return queuePlan(
      queue,
      todaySlots ? appliesDay(today, todaySlots) : emptyDay(today, "waiting"),
      tomorrowSlots ? appliesDay(tomorrow, tomorrowSlots) : emptyDay(tomorrow, "waiting"),
      updated,
    )
  })
}

export function parsePoltavaTable(html: string): Map<string, Slot[]> {
  const table = html.match(/<table class="gpv-table"[\s\S]*?<\/table>/)?.[0] ?? ""
  const found = new Map<string, Slot[]>()
  for (const row of table.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    const queue = row.match(/class="gpv-q"[^>]*>\s*(\d{1,2}\.\d)\s*</)?.[1]
    if (!queue) continue
    const cells = [...row.matchAll(/gpv-s([123])/g)].map((match) => match[1])
    if (cells.length < 48) continue
    found.set(
      queue,
      cells.slice(0, 48).map((cell) => (cell === "2" ? 1 : cell === "3" ? 2 : 0) as Slot),
    )
  }
  return found
}

const RIVNE_QUEUES = QUEUE_PAIRS

export function parseRivne(html: string, today: string, tomorrow: string): QueuePlan[] {
  const updatedMatch = html.match(/Оновлено:\s*(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})/)
  const updated = updatedMatch ? kyivStamp(`${updatedMatch[1]} ${updatedMatch[2]}`) : null
  const days = new Map<string, Map<string, DayPlan>>()
  for (const row of html.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    const cells = [...row.matchAll(/<td[\s\S]*?<\/td>/g)].map((cell) => stripHtml(cell[0]).replace(/\s+/g, " ").trim())
    if (cells.length < 13) continue
    const iso = dmyToIso(cells[0] ?? "")
    if (!iso) continue
    const queues = new Map<string, DayPlan>()
    RIVNE_QUEUES.forEach((queue, index) => {
      queues.set(queue, rivneCell(cells[index + 1] ?? "", iso))
    })
    days.set(iso, queues)
  }
  if (days.size === 0) return []
  return RIVNE_QUEUES.map((queue) =>
    queuePlan(
      queue,
      days.get(today)?.get(queue) ?? emptyDay(today, "waiting"),
      days.get(tomorrow)?.get(queue) ?? emptyDay(tomorrow, "waiting"),
      updated,
    ),
  )
}

function rivneCell(value: string, date: string): DayPlan {
  const text = value.toLowerCase()
  if (/очікується|ожидается|немає даних|—|-/.test(text) && !/\d{1,2}:\d{2}/.test(text)) {
    return emptyDay(date, "waiting")
  }
  if (/не застос|відключень немає|без відключ/.test(text)) return emptyDay(date, "none")
  const ranges = [...value.matchAll(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/g)].map(
    (match) => [clockToMin(match[1]!), clockToMin(match[2]!)] as [number, number],
  )
  if (ranges.length === 0) return emptyDay(date, "waiting")
  return appliesDay(date, slotsFromRanges(ranges))
}

export interface FrankivskEntry {
  eventDate?: string
  queues?: Record<string, Array<{ from?: string; to?: string; status?: number }>>
  scheduleApprovedSince?: string
}

export function parseFrankivsk(entries: FrankivskEntry[], today: string, tomorrow: string): QueuePlan[] {
  const byQueue = new Map<string, Map<string, Slot[]>>()
  let updated: string | null = null
  for (const entry of entries) {
    const iso = entry.eventDate ? dmyToIso(entry.eventDate) : null
    if (!iso || (iso !== today && iso !== tomorrow)) continue
    if (entry.scheduleApprovedSince) {
      const stamp = kyivStamp(entry.scheduleApprovedSince)
      if (stamp) updated = stamp
    }
    for (const [queue, ranges] of Object.entries(entry.queues ?? {})) {
      const slots = onSlots()
      for (const range of ranges) {
        if (!range.from || !range.to) continue
        const value: Slot = range.status === 1 ? 1 : range.status === 0 ? 0 : 2
        if (value !== 0) paint(slots, clockToMin(range.from), clockToMin(range.to), value)
      }
      const bucket = byQueue.get(queue) ?? new Map()
      bucket.set(iso, slots)
      byQueue.set(queue, bucket)
    }
  }
  if (byQueue.size === 0) {
    return QUEUE_PAIRS.map((queue) => queuePlan(queue, emptyDay(today, "waiting"), emptyDay(tomorrow, "waiting"), null))
  }
  return [...byQueue.keys()].map((queue) => {
    const days = byQueue.get(queue)!
    return queuePlan(
      queue,
      days.has(today) ? appliesDay(today, days.get(today)!) : emptyDay(today, "waiting"),
      days.has(tomorrow) ? appliesDay(tomorrow, days.get(tomorrow)!) : emptyDay(tomorrow, "waiting"),
      updated,
    )
  })
}

export function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
}

export function rssItems(xml: string): Array<{ title: string; html: string }> {
  const items: Array<{ title: string; html: string }> = []
  for (const block of xml.match(/<item[\s\S]*?<\/item>/g) ?? []) {
    const title = decodeXml(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "")
    const html = decodeXml(block.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? "")
    items.push({ title: stripHtml(title).replace(/\s+/g, " ").trim(), html })
  }
  return items
}

export function isoDate(value: string): string {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
  if (match) return match[1]!
  return addIsoDays(kyivNow(new Date()).date, 0)
}

export function parseChernivtsi(html: string): { date: string | null; groups: Map<string, Slot[]> } {
  const stamp = html.match(/(\d{2}\.\d{2}\.\d{4})/)
  const date = stamp ? dmyToIso(stamp[1]!) : null
  const groups = new Map<string, Slot[]>()
  for (const match of html.matchAll(/<div id="inf(\d+)"[^>]*>([\s\S]*?)<\/div>/g)) {
    const cells = [...match[2].matchAll(/<(u|o|s)>([^<]+)<\/\1>/gi)]
    if (cells.length !== 48) continue
    const slots = cells.map((cell) => cellMark(cell[2]!))
    groups.set(match[1]!, slots)
  }
  return { date, groups }
}

function cellMark(value: string): Slot {
  const kind = value.trim().toLowerCase()
  if (kind === "в") return 1
  if (kind === "мз") return 2
  if (kind === "з") return 0
  throw new Error(`Чернівці: невідома позначка ${kind}`)
}

export function htmlArticles(html: string): Array<{ title: string; html: string }> {
  const articles: Array<{ title: string; html: string }> = []
  for (const match of html.matchAll(/<article[^>]*>\s*<h2>([\s\S]*?)<\/h2>([\s\S]*?)<\/article>/gi)) {
    articles.push({ title: stripHtml(match[1]!).replace(/\s+/g, " ").trim(), html: match[2]! })
  }
  return articles
}

export function telegramMessages(html: string): Array<{ at: string; text: string }> {
  const messages: Array<{ at: string; text: string }> = []
  for (const block of html.split("tgme_widget_message_wrap").slice(1)) {
    const text = block.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/)
    const time = block.match(/datetime="([^"]+)"/)
    if (!text || !time) continue
    messages.push({ at: time[1]!, text: stripHtml(text[1]!).replace(/\s+/g, " ").trim() })
  }
  return messages
}

export function scheduleDate(text: string): string | null {
  const stamp = text.match(/(\d{2}\.\d{2}\.\d{4})/)
  return stamp ? dmyToIso(stamp[1]!) : null
}
