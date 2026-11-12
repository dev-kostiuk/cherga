import { type CatalogItem } from "./catalog.ts"
import {
  type OperatorPlan,
  type QueuePlan,
  type Slot,
  QUEUE_PAIRS,
  addIsoDays,
  compareQueues,
  emptyDay,
  kyivNow,
  onSlots,
  queuePlan,
} from "./model.ts"
import { decodeWindows1251, getBytes, getText } from "./net.ts"
import {
  type FrankivskEntry,
  type YasnoDay,
  isoDate,
  parseChernivtsi,
  parseDtekFact,
  parseFrankivsk,
  parsePoltavaTable,
  parseQueueIntervals,
  parseRivne,
  parseYasnoDay,
  parseZhytomyr,
  plansFromDays,
  rssItems,
  scheduleDate,
  telegramMessages,
  titleDate,
  htmlArticles,
} from "./parse.ts"

const LIVE = new Set([
  "kyiv",
  "kyiv-region",
  "dnipro",
  "cek",
  "zhytomyr",
  "ivano-frankivsk",
  "mykolaiv",
  "odesa",
  "poltava",
  "rivne",
  "kharkiv",
  "cherkasy",
  "zaporizhzhia",
  "kirovohrad",
  "khmelnytskyi",
  "chernivtsi",
  "chernihiv",
])

export function isLive(id: string): boolean {
  return LIVE.has(id)
}

export async function fetchOperator(item: CatalogItem, now = new Date()): Promise<OperatorPlan> {
  const today = kyivNow(now).date
  const tomorrow = addIsoDays(today, 1)
  const queues = (await loadQueues(item.id, today, tomorrow)).sort((a, b) => compareQueues(a.queue, b.queue))
  return base(item, queues, null)
}

export function gapOperator(item: CatalogItem): OperatorPlan {
  return base(item, [], null)
}

export function failedOperator(item: CatalogItem, error: unknown): OperatorPlan {
  const message = error instanceof Error ? error.message : String(error)
  return base(item, [], message)
}

function base(item: CatalogItem, queues: QueuePlan[], error: string | null): OperatorPlan {
  return {
    id: item.id,
    name: item.name,
    short: item.short,
    oblast: item.oblast,
    oblastSlug: item.oblastSlug,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl,
    fetchedAt: error || queues.length === 0 ? null : new Date().toISOString(),
    ok: error == null,
    error,
    note: queues.length > 0 ? null : item.note,
    queues,
  }
}

async function loadQueues(id: string, today: string, tomorrow: string): Promise<QueuePlan[]> {
  switch (id) {
    case "kyiv":
      return yasno(25, 902, today, tomorrow)
    case "dnipro":
      return yasno(3, 301, today, tomorrow)
    case "cek":
      return yasno(3, 303, today, tomorrow)
    case "kyiv-region":
      return dtekMirror("kyiv-region", today, tomorrow)
    case "odesa":
      return dtekMirror("odesa", today, tomorrow)
    case "mykolaiv":
      return mykolaiv(today, tomorrow)
    case "zhytomyr":
      return zhytomyr(today, tomorrow)
    case "poltava":
      return poltava(today, tomorrow)
    case "rivne":
      return rivne(today, tomorrow)
    case "cherkasy":
      return cherkasy(today, tomorrow)
    case "kharkiv":
      return kharkiv(today, tomorrow)
    case "ivano-frankivsk":
      return frankivsk(today, tomorrow)
    case "zaporizhzhia":
      return zaporizhzhia(today, tomorrow)
    case "kirovohrad":
      return kirovohrad(today, tomorrow)
    case "khmelnytskyi":
      return communityFact("Khmelnytskoblenerho.json", today, tomorrow)
    case "chernivtsi":
      return chernivtsi(today, tomorrow)
    case "chernihiv":
      return communityFact("Chernihivoblenergo.json", today, tomorrow)
    default:
      return []
  }
}

async function yasno(region: number, dso: number, today: string, tomorrow: string): Promise<QueuePlan[]> {
  const url = `https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/${region}/dsos/${dso}/planned-outages`
  const payload = JSON.parse(await getText(url)) as Record<
    string,
    { today?: YasnoDay; tomorrow?: YasnoDay; updatedOn?: string }
  >
  return Object.entries(payload).map(([queue, item]) =>
    queuePlan(queue, parseYasnoDay(item.today, today), parseYasnoDay(item.tomorrow, tomorrow), item.updatedOn ?? null),
  )
}

async function dtekMirror(file: string, today: string, tomorrow: string): Promise<QueuePlan[]> {
  const url = `https://raw.githubusercontent.com/Baskerville42/outage-data-ua/main/data/${file}.json`
  const payload = JSON.parse(await getText(url)) as {
    lastUpdateStatus?: { ok?: boolean }
    fact?: { data?: Record<string, Record<string, Record<string, string>>>; update?: string }
  }
  if (payload.lastUpdateStatus?.ok === false) throw new Error(`дзеркало ${file} позначене як несвіже`)
  const queues = parseDtekFact(payload.fact ?? {}, today, tomorrow)
  if (queues.length === 0) throw new Error(`дзеркало ${file} без графіка`)
  return queues
}

async function mykolaiv(today: string, tomorrow: string): Promise<QueuePlan[]> {
  const baseUrl = "https://off.energy.mk.ua"
  const queueList = JSON.parse(await getText(`${baseUrl}/api/outage-queue/by-type/3`)) as Array<{
    id: number
    name: string
    deleted?: number
  }>
  const series = JSON.parse(await getText(`${baseUrl}/api/schedule/time-series`)) as Array<{ id: number; start: string }>
  const active = JSON.parse(await getText(`${baseUrl}/api/v2/schedule/active`)) as Array<{
    from: string
    series: Array<{ time_series_id: number; outage_queue_id: number; type: string }>
  }>
  const names = new Map(queueList.filter((item) => !item.deleted).map((item) => [item.id, item.name]))
  const slotOf = new Map(
    series.map((item) => {
      const [hour, minute] = item.start.split(":").map(Number)
      return [item.id, (hour ?? 0) * 2 + ((minute ?? 0) >= 30 ? 1 : 0)] as const
    }),
  )
  const days = new Map<string, Map<number, Slot[]>>()
  for (const day of active) {
    const date = kyivNow(new Date(day.from)).date
    if (date !== today && date !== tomorrow) continue
    const queues = days.get(date) ?? new Map<number, Slot[]>()
    for (const entry of day.series ?? []) {
      const index = slotOf.get(entry.time_series_id)
      if (index == null || index < 0 || index > 47) continue
      const slots = queues.get(entry.outage_queue_id) ?? onSlots()
      const type = entry.type.toUpperCase()
      if (type === "OFF" || type === "SURE_OFF") slots[index] = 1
      else if (type === "PROBABLY_OFF" && slots[index] !== 1) slots[index] = 2
      queues.set(entry.outage_queue_id, slots)
    }
    days.set(date, queues)
  }
  return [...names.entries()].map(([id, name]) => {
    const todaySlots = days.get(today)?.get(id)
    const tomorrowSlots = days.get(tomorrow)?.get(id)
    return queuePlan(
      name,
      days.has(today) ? { date: today, status: "applies", slots: todaySlots ?? onSlots() } : emptyDay(today, "waiting"),
      days.has(tomorrow)
        ? { date: tomorrow, status: "applies", slots: tomorrowSlots ?? onSlots() }
        : emptyDay(tomorrow, "waiting"),
      null,
    )
  })
}

async function zhytomyr(today: string, tomorrow: string): Promise<QueuePlan[]> {
  const html = decodeWindows1251(await getBytes("https://www.ztoe.com.ua/unhooking-search.php"))
  const queues = parseZhytomyr(html, today, tomorrow)
  if (queues.length === 0) throw new Error("Житомир: таблицю не розібрано")
  return queues
}

async function poltava(today: string, tomorrow: string): Promise<QueuePlan[]> {
  const todayRows = await poltavaDay(today)
  const tomorrowRows = await poltavaDay(tomorrow)
  const names = new Set([...todayRows.keys(), ...tomorrowRows.keys()])
  if (names.size === 0) {
    return QUEUE_PAIRS.map((queue) => queuePlan(queue, emptyDay(today, "waiting"), emptyDay(tomorrow, "waiting"), null))
  }
  return [...names].map((queue) =>
    queuePlan(
      queue,
      todayRows.get(queue)
        ? { date: today, status: "applies", slots: todayRows.get(queue)! }
        : emptyDay(today, todayRows.size > 0 ? "none" : "waiting"),
      tomorrowRows.get(queue)
        ? { date: tomorrow, status: "applies", slots: tomorrowRows.get(queue)! }
        : emptyDay(tomorrow, "waiting"),
      null,
    ),
  )
}

async function poltavaDay(iso: string): Promise<Map<string, Slot[]>> {
  const [year, month, day] = iso.split("-")
  const body = `seldate=${encodeURIComponent(JSON.stringify({ date_in: `${day}-${month}-${year}` }))}`
  const html = await getText("https://www.poe.pl.ua/customs/newgpv-info.php", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  })
  if (!html.includes("gpv-table")) return new Map()
  return parsePoltavaTable(html)
}

async function rivne(today: string, tomorrow: string): Promise<QueuePlan[]> {
  const queues = parseRivne(await getText("https://www.roe.vsei.ua/disconnections"), today, tomorrow)
  if (queues.length === 0) throw new Error("Рівне: таблицю не розібрано")
  return queues
}

async function cherkasy(today: string, tomorrow: string): Promise<QueuePlan[]> {
  const list = JSON.parse(
    await getText("https://www.cherkasyoblenergo.com/api/v1/posts/main?lang=uk&limit=40"),
  ) as { data?: Array<{ title: string; slug: string; publishedAt: string }> }
  return textPosts(list.data ?? [], today, tomorrow, async (post) => {
    const full = JSON.parse(
      await getText(`https://www.cherkasyoblenergo.com/api/v1/posts/${post.slug}?lang=uk`),
    ) as { data?: { content?: string; publishedAt?: string } }
    return { html: full.data?.content ?? "", publishedAt: full.data?.publishedAt ?? post.publishedAt }
  })
}

async function kharkiv(today: string, tomorrow: string): Promise<QueuePlan[]> {
  const posts = rssItems(await getText("https://oblenergo.kharkiv.ua/uk/rss.xml"))
    .filter((item) => /погодинн/i.test(item.title))
    .map((item, index) => ({
      title: item.title,
      slug: String(index),
      publishedAt: new Date(Date.now() - index * 60_000).toISOString(),
      html: item.html,
    }))
  return textPosts(posts, today, tomorrow, async (post) => ({
    html: post.html ?? "",
    publishedAt: post.publishedAt,
  }))
}

interface TextPost {
  title: string
  slug: string
  publishedAt: string
  html?: string
}

async function textPosts(
  posts: TextPost[],
  today: string,
  tomorrow: string,
  load: (post: TextPost) => Promise<{ html: string; publishedAt: string }>,
): Promise<QueuePlan[]> {
  const best = new Map<string, TextPost>()
  for (const post of posts) {
    if (!/гпв|погодинн/i.test(post.title)) continue
    const date = titleDate(post.title, post.publishedAt)
    if (!date || (date !== today && date !== tomorrow)) continue
    const current = best.get(date)
    if (!current || post.publishedAt > current.publishedAt) best.set(date, post)
  }
  const days = new Map<string, Map<string, Array<[number, number]>>>()
  const cancelled = new Set<string>()
  let updated: string | null = null
  for (const [date, post] of best) {
    const loaded = await load(post)
    updated = isoDate(loaded.publishedAt)
    if (/скасован|не запланован/i.test(`${post.title} ${loaded.html}`)) {
      cancelled.add(date)
      continue
    }
    const intervals = parseQueueIntervals(loaded.html)
    if (intervals.size < 8) throw new Error(`у тексті на ${date} замало черг`)
    days.set(date, intervals)
  }
  const queues = plansFromDays(days, today, tomorrow, updated)
  if (cancelled.size > 0) {
    const names = queues.length > 0 ? queues.map((queue) => queue.queue) : QUEUE_PAIRS
    return names.map((queue) => {
      const existing = queues.find((item) => item.queue === queue)
      return queuePlan(
        queue,
        cancelled.has(today) ? emptyDay(today, "none") : (existing?.today ?? emptyDay(today, "waiting")),
        cancelled.has(tomorrow) ? emptyDay(tomorrow, "none") : (existing?.tomorrow ?? emptyDay(tomorrow, "waiting")),
        updated,
      )
    })
  }
  if (queues.length === 0) throw new Error("текст графіка не розібрано")
  return queues
}

async function frankivsk(today: string, tomorrow: string): Promise<QueuePlan[]> {
  const entries: FrankivskEntry[] = []
  for (let group = 1; group <= 6; group += 1) {
    for (const sub of [1, 2]) {
      const payload = JSON.parse(
        await getText(`https://be-svitlo.oe.if.ua/schedule-by-queue?queue=${group}.${sub}`),
      ) as FrankivskEntry[]
      if (Array.isArray(payload)) entries.push(...payload)
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
  }
  return parseFrankivsk(entries, today, tomorrow)
}

const COMMUNITY = "https://raw.githubusercontent.com/yaroslav2901/OE_OUTAGE_DATA/main/data"
const FRESH_MS = 36 * 60 * 60 * 1000

async function communityFact(file: string, today: string, tomorrow: string): Promise<QueuePlan[]> {
  const payload = JSON.parse(await getText(`${COMMUNITY}/${file}`)) as {
    lastUpdated?: string
    fact?: { data?: Record<string, Record<string, Record<string, string>>>; update?: string }
  }
  const updated = payload.lastUpdated ? new Date(payload.lastUpdated).getTime() : 0
  if (!updated || Date.now() - updated > FRESH_MS) throw new Error(`${file} застарів`)
  const queues = parseDtekFact(payload.fact ?? {}, today, tomorrow)
  const useful = queues.some((queue) => queue.today.slots.length === 48 || queue.tomorrow.slots.length === 48)
  if (!useful) throw new Error(`${file} без годин на сьогодні чи завтра`)
  return queues
}

async function chernivtsi(today: string, tomorrow: string): Promise<QueuePlan[]> {
  const current = parseChernivtsi(await getText("https://oblenergo.cv.ua/shutdowns/"))
  const next = parseChernivtsi(await getText("https://oblenergo.cv.ua/shutdowns/?next"))
  const todayGroups = current.date === today ? current.groups : next.date === today ? next.groups : null
  const tomorrowGroups = next.date === tomorrow ? next.groups : current.date === tomorrow ? current.groups : null
  if (!todayGroups || todayGroups.size < 8) throw new Error("Чернівці: сітку не розібрано")
  return [...todayGroups.keys()].map((queue) =>
    queuePlan(
      queue,
      { date: today, status: "applies", slots: todayGroups.get(queue)! },
      tomorrowGroups?.get(queue)
        ? { date: tomorrow, status: "applies", slots: tomorrowGroups.get(queue)! }
        : emptyDay(tomorrow, "waiting"),
      null,
    ),
  )
}

async function zaporizhzhia(today: string, tomorrow: string): Promise<QueuePlan[]> {
  try {
    const articles = htmlArticles(await getText("https://www.zoe.com.ua/outage/")).map((article, index) => ({
      title: article.title,
      slug: String(index),
      publishedAt: new Date(Date.now() - index * 60_000).toISOString(),
      html: article.html,
    }))
    return await textPosts(articles, today, tomorrow, async (post) => ({
      html: post.html ?? "",
      publishedAt: post.publishedAt,
    }))
  } catch {
    return communityFact("Zaporizhzhiaoblenergo.json", today, tomorrow)
  }
}

async function kirovohrad(today: string, tomorrow: string): Promise<QueuePlan[]> {
  const messages = telegramMessages(await getText("https://t.me/s/SvitloKropyvnytskyiMisto"))
  const best = new Map<string, { at: string; text: string }>()
  for (const message of messages) {
    const date = scheduleDate(message.text)
    if (!date || (date !== today && date !== tomorrow)) continue
    if (!/гпв|погодинн/i.test(message.text)) continue
    const current = best.get(date)
    if (!current || message.at > current.at) best.set(date, message)
  }
  const days = new Map<string, Map<string, Array<[number, number]>>>()
  const cancelled = new Set<string>()
  let updated: string | null = null
  for (const [date, message] of best) {
    updated = message.at
    if (/скасован/i.test(message.text)) {
      cancelled.add(date)
      continue
    }
    const intervals = parseQueueIntervals(message.text)
    if (intervals.size < 8) throw new Error(`Кіровоград: у тексті на ${date} замало черг`)
    days.set(date, intervals)
  }
  if (days.size === 0 && cancelled.size === 0) throw new Error("Кіровоград: немає графіка на сьогодні чи завтра")
  const queues = plansFromDays(days, today, tomorrow, updated)
  if (cancelled.size === 0) return queues
  const known = [...days.values()][0]
  const names = queues.length > 0 ? queues.map((queue) => queue.queue) : [...(known?.keys() ?? QUEUE_PAIRS)]
  return names.map((queue) => {
    const existing = queues.find((item) => item.queue === queue)
    return queuePlan(
      queue,
      cancelled.has(today) ? emptyDay(today, "none") : (existing?.today ?? emptyDay(today, "waiting")),
      cancelled.has(tomorrow) ? emptyDay(tomorrow, "none") : (existing?.tomorrow ?? emptyDay(tomorrow, "waiting")),
      updated,
    )
  })
}
