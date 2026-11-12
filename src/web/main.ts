import { addEntry, type Board, decodeBoard, encodeBoard, type Entry, entryKey, focusEntry, groupEntries, normalizeStored, removeEntry, sameArea } from "../board.ts"
import { type DayPlan, type OperatorPlan, type QueuePlan, SLOT_COUNT, type Slot, type Snapshot, compareQueues, headline, kyivNow, ukDate } from "../model.ts"
import { renderBoardWallpaper, type WallpaperInput } from "../render.ts"
import { type PlaceHit, type PlacesFile, searchPlaces } from "../search.ts"

const query = document.querySelector<HTMLInputElement>("#query")!
const searchLabel = document.querySelector<HTMLElement>("#search-label")!
const otherPlace = document.querySelector<HTMLButtonElement>("#other-place")!
const results = document.querySelector<HTMLElement>("#results")!
const operatorsEl = document.querySelector<HTMLElement>("#operators")!
const operatorList = document.querySelector<HTMLElement>("#operator-list")!
const queuesEl = document.querySelector<HTMLElement>("#queues")!
const queueList = document.querySelector<HTMLElement>("#queue-list")!
const queueFilterLabel = document.querySelector<HTMLElement>("#queue-filter-label")!
const queueFilter = document.querySelector<HTMLInputElement>("#queue-filter")!
const queueHint = document.querySelector<HTMLElement>("#queue-hint")!
const queueMiss = document.querySelector<HTMLElement>("#queue-miss")!
const sourceLine = document.querySelector<HTMLElement>("#source-line")!
const note = document.querySelector<HTMLElement>("#note")!
const empty = document.querySelector<HTMLElement>("#empty")!
const boardEl = document.querySelector<HTMLElement>("#board")!
const groupsEl = document.querySelector<HTMLElement>("#groups")!
const sheet = document.querySelector<HTMLElement>("#sheet")!
const sheetTitle = document.querySelector<HTMLElement>("#sheet-title")!
const now = document.querySelector<HTMLElement>("#now")!
const nowSub = document.querySelector<HTMLElement>("#now-sub")!
const lines = document.querySelector<HTMLElement>("#lines")!
const phone = document.querySelector<HTMLElement>("#phone")!
const back = document.querySelector<HTMLAnchorElement>("#back")!
const caption = document.querySelector<HTMLElement>("#caption")!
const link = document.querySelector<HTMLInputElement>("#link")!
const copy = document.querySelector<HTMLButtonElement>("#copy")!
const addQueue = document.querySelector<HTMLButtonElement>("#add-queue")!
const status = document.querySelector<HTMLElement>("#status")!

let places: PlacesFile | null = null
let snapshot: Snapshot | null = null
let place: PlaceHit | null = null
let operator: OperatorPlan | null = null
let board: Board = { entries: [], focus: null }
let flashTimer = 0

status.textContent = "Завантажую місця і графіки…"
try {
  ;[places, snapshot] = await Promise.all([
    fetch("data/places.json").then((response) => response.json() as Promise<PlacesFile>),
    fetch("data/schedules.json").then((response) => response.json() as Promise<Snapshot>),
  ])
  status.textContent = ""
  restore()
} catch {
  status.textContent = "Не вдалося завантажити дані. Оновіть сторінку."
}

query.addEventListener("input", () => {
  place = null
  operator = null
  render()
})
queueFilter.addEventListener("input", render)
queueFilter.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return
  event.preventDefault()
  addTypedQueue()
})
addQueue.addEventListener("click", addTypedQueue)
otherPlace.addEventListener("click", () => {
  place = null
  operator = null
  query.value = ""
  queueFilter.value = ""
  render()
  query.focus()
})
copy.addEventListener("click", () => {
  if (link.value) void copyText(link.value, copy, "Скопіювати посилання")
})

function render(): void {
  if (!board.entries.length) document.body.classList.remove("screen-only")
  renderBoard()
  renderSearch()
  renderResults()
  renderPicker()
  renderSheet()
}

function renderSearch(): void {
  otherPlace.hidden = !place
  searchLabel.textContent = place ? "1 · Обране місце" : board.entries.length > 0 ? "1 · Додати ще місце" : "1 · Місто"
}

function renderResults(): void {
  if (!places || place) {
    results.replaceChildren()
    return
  }
  const hits = searchPlaces(places, query.value)
  results.replaceChildren(
    ...hits.map((hit) => {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "result"
      const title = document.createElement("strong")
      title.textContent = hit.label
      const detail = document.createElement("span")
      detail.textContent = hit.detail.includes(hit.oblastName) ? hit.detail : `${hit.detail} · ${hit.oblastName}`
      button.append(title, detail)
      button.addEventListener("click", () => choosePlace(hit))
      return button
    }),
  )
}

function choosePlace(hit: PlaceHit): void {
  place = hit
  query.value = hit.label
  const options = operatorsFor(hit.oblastSlug)
  operator = options.length === 1 ? options[0]! : null
  queueFilter.value = ""
  render()
}

function renderPicker(): void {
  const options = place && snapshot ? operatorsFor(place.oblastSlug) : []
  operatorsEl.hidden = options.length < 2
  operatorList.replaceChildren(
    ...options.map((item) => {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "choice"
      button.textContent = item.short
      button.setAttribute("aria-pressed", String(item.id === operator?.id))
      button.addEventListener("click", () => {
        operator = item
        render()
      })
      return button
    }),
  )

  const showQueues = Boolean(place && (operator || options.length === 0))
  queuesEl.hidden = !showQueues
  if (!showQueues || !place) return

  const queues = operator ? [...operator.queues].sort((a, b) => compareQueues(a.queue, b.queue)) : []
  if (!operator || options.length === 0) {
    showNote(options.length === 0 ? "Для цієї області графіка ще немає." : "Оберіть оператора.")
  } else if (operator.note && queues.length === 0) {
    showNote(operator.note)
  } else if (queues.length === 0) {
    showNote("Для цього оператора зараз немає опублікованого графіка.")
  } else {
    note.hidden = true
    note.textContent = ""
    queueHint.hidden = false
    sourceLine.hidden = false
    sourceLine.textContent = `Графік: ${operator.short}`
  }

  queueFilterLabel.hidden = queues.length === 0
  const filter = queueFilter.value.replace(",", ".").trim()
  const visible = queues.filter((item) => !filter || item.queue.startsWith(filter))
  queueMiss.hidden = queues.length === 0 || visible.length > 0
  const minutes = kyivNow(new Date()).minutes
  queueList.replaceChildren(
    ...visible.map((item) => {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "queue"
      const added = place !== null && board.entries.some((entry) => entry.operatorId === operator?.id && entry.queue === item.queue && entry.label === place.label)
      button.setAttribute("aria-pressed", String(added))
      button.append(dot(toneOf(item, minutes)), document.createTextNode(item.queue))
      button.addEventListener("click", () => onQueue(item.queue))
      return button
    }),
  )
}

function showNote(text: string): void {
  note.hidden = false
  note.textContent = text
  queueHint.hidden = true
  sourceLine.hidden = true
  sourceLine.textContent = ""
}

function addTypedQueue(): void {
  if (!place || !operator) return
  const filter = queueFilter.value.replace(",", ".").trim()
  const exact = operator.queues.find((item) => item.queue === filter)
  const starts = operator.queues.filter((item) => item.queue.startsWith(filter))
  const chosen = exact ?? (starts.length === 1 ? starts[0] : null)
  if (!chosen) {
    flash("У цьому графіку такого номера немає.")
    return
  }
  onQueue(chosen.queue)
}

function onQueue(queueId: string): void {
  if (!place || !operator) return
  const entry = entryFrom(place, queueId)
  const key = entryKey(entry)
  const exists = board.entries.some((item) => entryKey(item) === key)
  board = exists ? focusEntry(board, key) : addEntry(board, entry)
  persist()
  render()
  if (!exists) flash(`Додано: ${entry.label}, черга ${entry.queue}`)
}

function renderBoard(): void {
  const entries = board.entries
  empty.hidden = entries.length > 0
  boardEl.hidden = entries.length === 0
  groupsEl.replaceChildren(
    ...groupEntries(entries).map((group) => {
      const section = document.createElement("section")
      section.className = "group"
      const title = document.createElement("h3")
      title.textContent = group.label
      const where = document.createElement("p")
      where.className = "where"
      where.textContent = groupWhere(group.entries[0]!)
      section.append(title, where)
      const pills = document.createElement("div")
      pills.className = "place-pills"
      for (const entry of group.entries) pills.append(renderPill(entry))
      section.append(pills)
      return section
    }),
  )
}

function renderPill(entry: Entry): HTMLElement {
  const resolved = resolve(entry)
  const wrap = document.createElement("div")
  wrap.className = "pill-wrap"
  const button = document.createElement("button")
  button.type = "button"
  button.className = "pill"
  const focused = entryKey(entry) === board.focus
  if (focused) button.classList.add("is-focus")
  const state = resolved.plan ? headline(resolved.plan.today, kyivNow(new Date()).minutes) : null
  const queueName = document.createElement("strong")
  queueName.textContent = entry.queue
  const statusText = document.createElement("span")
  statusText.className = "pill-status"
  statusText.textContent = state?.title ?? "немає даних"
  button.append(dot(state?.tone ?? "wait"), queueName, statusText)
  button.addEventListener("click", () => selectEntry(entry))
  const removeButton = document.createElement("button")
  removeButton.type = "button"
  removeButton.className = "pill-x"
  removeButton.textContent = "×"
  removeButton.setAttribute("aria-label", `Прибрати ${entry.label}, черга ${entry.queue}`)
  removeButton.addEventListener("click", () => remove(entry))
  wrap.append(button, removeButton)
  return wrap
}

function selectEntry(entry: Entry): void {
  board = focusEntry(board, entryKey(entry))
  openEntry(entry)
  persist()
  render()
}

function remove(entry: Entry): void {
  board = removeEntry(board, entryKey(entry))
  const next = board.entries.find((item) => entryKey(item) === board.focus) ?? null
  if (next) openEntry(next)
  else {
    place = null
    operator = null
    query.value = ""
    queueFilter.value = ""
  }
  persist()
  render()
}

function renderSheet(): void {
  const entries = board.entries
  const screenOnly = document.body.classList.contains("screen-only")
  sheet.hidden = entries.length === 0
  if (!entries.length) return
  const focus = entries.find((item) => entryKey(item) === board.focus) ?? entries[0]!
  const resolved = resolve(focus)
  const many = entries.length > 1
  const several = (snapshot?.operators.filter((item) => item.oblastSlug === focus.oblastSlug).length ?? 0) > 1
  sheetTitle.textContent = many
    ? "Усе на одному екрані"
    : several && resolved.operator
      ? `${focus.label} · ${resolved.operator.short} · ${focus.queue}`
      : `${focus.label} · черга ${focus.queue}`
  const minutes = kyivNow(new Date()).minutes
  const showSingle = !screenOnly && !many && !!resolved.plan
  now.hidden = !showSingle
  nowSub.hidden = !showSingle
  if (showSingle && resolved.plan) {
    const state = headline(resolved.plan.today, minutes)
    now.textContent = state.title
    now.className = `now ${state.tone}`
    nowSub.textContent = state.sub
  }
  lines.hidden = !screenOnly && !many && !!resolved.plan
  if (!lines.hidden) lines.replaceChildren(...entries.map((entry) => renderLine(entry, minutes)))
  const shared = !many && resolved.operator && !sameArea(focus.label, resolved.operator.oblast)
    ? `${focus.label} · той самий графік, що й ${resolved.operator.oblast}.`
    : ""
  caption.hidden = !shared
  caption.textContent = shared
  phone.innerHTML = renderBoardWallpaper(entries.map(wallpaperInput))
  back.href = pageUrl(false)
  link.value = pageUrl(true)
}

function openEntry(entry: Entry): void {
  place = {
    label: entry.label,
    detail: entry.detail,
    oblastSlug: entry.oblastSlug,
    oblastName: entry.oblastName,
  }
  query.value = entry.label
  operator = snapshot?.operators.find((item) => item.id === entry.operatorId) ?? null
}

function entryFrom(hit: PlaceHit, queueId: string): Entry {
  return {
    operatorId: operator!.id,
    queue: queueId,
    label: hit.label,
    detail: hit.detail,
    oblastSlug: hit.oblastSlug,
    oblastName: hit.oblastName,
  }
}

function resolve(entry: Entry): { operator: OperatorPlan | null, plan: QueuePlan | null } {
  const found = snapshot?.operators.find((item) => item.id === entry.operatorId) ?? null
  return { operator: found, plan: found?.queues.find((item) => item.queue === entry.queue) ?? null }
}

function groupWhere(entry: Entry): string {
  const found = snapshot?.operators.find((item) => item.id === entry.operatorId)
  const source = found?.short ?? ""
  if (sameArea(entry.label, found?.oblast ?? entry.oblastName)) return source
  return [entry.oblastName, source].filter(Boolean).join(" · ")
}

function operatorsFor(slug: string): OperatorPlan[] {
  return snapshot?.operators.filter((item) => item.oblastSlug === slug) ?? []
}

function toneOf(plan: QueuePlan, minutes: number): string {
  return headline(plan.today, minutes).tone
}

function dot(tone: string): HTMLElement {
  const mark = document.createElement("span")
  mark.className = `dot ${tone}`
  mark.setAttribute("aria-hidden", "true")
  return mark
}

function wallpaperInput(entry: Entry): WallpaperInput {
  const { operator: current, plan } = resolve(entry)
  const today = kyivNow(new Date()).date
  const blank = (date: string): DayPlan => ({ date, status: "unavailable", slots: [] })
  if (!current || !plan) {
    return {
      place: entry.label,
      queue: entry.queue,
      source: current?.short ?? "",
      today: blank(today),
      tomorrow: blank(today),
      updated: current?.fetchedAt ?? null,
    }
  }
  return {
    place: entry.label,
    queue: entry.queue,
    source: current.short,
    today: plan.today,
    tomorrow: plan.tomorrow,
    updated: plan.updated ?? current.fetchedAt,
  }
}

function renderLine(entry: Entry, minutes: number): HTMLElement {
  const { operator: current, plan } = resolve(entry)
  const state = plan
    ? headline(plan.today, minutes)
    : { title: "Немає даних", sub: current?.note || "Графік ще не підключено", tone: "wait" as const }
  const area = current && !sameArea(entry.label, current.oblast) ? `${current.oblast} · ` : ""
  const row = document.createElement("li")
  row.className = "line"
  const top = document.createElement("div")
  top.className = "line-top"
  const name = document.createElement("strong")
  name.textContent = `${entry.label} · ${entry.queue}`
  const mark = document.createElement("span")
  mark.className = `state ${state.tone}`
  mark.textContent = state.title
  top.append(name, mark)
  const sub = document.createElement("span")
  sub.className = "sub"
  sub.textContent = `${area}${state.sub}`
  row.append(top, sub)
  if (plan) {
    appendDay(row, "Сьогодні", plan.today, true)
    appendDay(row, "Завтра", plan.tomorrow, false)
  }
  return row
}

function appendDay(parent: HTMLElement, label: string, day: DayPlan, today: boolean): void {
  const name = document.createElement("p")
  name.className = "day-label"
  name.textContent = day.date ? `${label} · ${ukDate(day.date)}` : label
  parent.append(name)
  if ((day.status === "applies" || day.status === "none") && day.slots.length === SLOT_COUNT) {
    const bar = document.createElement("div")
    bar.className = today ? "bar today" : "bar"
    bar.style.background = barBackground(day.slots)
    if (today) bar.style.setProperty("--now", `${(kyivNow(new Date()).minutes / 1440) * 100}%`)
    bar.setAttribute("aria-hidden", "true")
    parent.append(bar)
    return
  }
  const message = document.createElement("p")
  message.className = "sub"
  message.textContent = day.status === "emergency"
    ? "Аварійні відключення, плановий графік не діє"
    : day.status === "none"
      ? "Відключень немає"
      : "Графік ще не опубліковано"
  parent.append(message)
}

function barBackground(slots: Slot[]): string {
  const stops = slots.map((slot, index) => {
    const color = slot === 1 ? "#1c1e24" : slot === 2 ? "#e2b15a" : "#f3efe4"
    const start = (index / SLOT_COUNT) * 100
    const end = ((index + 1) / SLOT_COUNT) * 100
    return `${color} ${start}% ${end}%`
  })
  return `linear-gradient(90deg, ${stops.join(", ")})`
}

function pageUrl(screen: boolean): string {
  const next = new URL(document.baseURI)
  next.search = ""
  next.hash = ""
  if (board.entries.length) next.searchParams.set("b", encodeBoard(board.entries))
  if (screen) next.searchParams.set("s", "1")
  return next.href
}

function persist(): void {
  localStorage.setItem("cherga", JSON.stringify(board))
  const screen = document.body.classList.contains("screen-only") && board.entries.length > 0
  const next = new URL(pageUrl(screen))
  const current = `${location.pathname}${location.search}`
  const target = `${next.pathname}${next.search}`
  if (current !== target) history.replaceState(null, "", next)
}

function restore(): void {
  const stored = normalizeStored(readRaw())
  const params = new URLSearchParams(location.search)
  const encoded = params.get("b")
  if (encoded) {
    const entries = decodeBoard(encoded).flatMap((item) => {
      const entry = hydrate(item)
      return entry ? [entry] : []
    })
    board = entries.length ? { entries, focus: entryKey(entries[entries.length - 1]!) } : stored
  } else {
    board = stored
    applyLegacy(params)
  }
  document.body.classList.toggle("screen-only", params.get("s") === "1" && board.entries.length > 0)
  const focused = board.entries.find((item) => entryKey(item) === board.focus) ?? null
  if (focused) openEntry(focused)
  persist()
  render()
}

function hydrate(raw: { operatorId: string, queue: string, label: string }): Entry | null {
  const found = snapshot?.operators.find((item) => item.id === raw.operatorId)
  if (!found || !places) return null
  const oblast = places.oblasts.find((item) => item.slug === found.oblastSlug)
  const oblastName = oblast?.name ?? found.oblast
  return {
    operatorId: raw.operatorId,
    queue: raw.queue,
    label: raw.label,
    detail: sameArea(raw.label, oblastName) ? "уся область" : oblastName,
    oblastSlug: found.oblastSlug,
    oblastName,
  }
}

function applyLegacy(params: URLSearchParams): void {
  const operatorId = params.get("o")
  const queueId = params.get("q")
  const placeLabel = params.get("p")
  if (!operatorId || !queueId || !snapshot || !places) return
  const found = snapshot.operators.find((item) => item.id === operatorId)
  if (!found?.queues.some((item) => item.queue === queueId)) return
  const oblast = places.oblasts.find((item) => item.slug === found.oblastSlug)
  const matches = board.entries.filter((item) => item.operatorId === operatorId && item.queue === queueId)
  const existing = placeLabel ? matches.find((item) => item.label === placeLabel) : matches[0]
  if (existing) {
    board = focusEntry(board, entryKey(existing))
    return
  }
  const label = placeLabel || oblast?.name || found.oblast
  board = addEntry(board, {
    operatorId,
    queue: queueId,
    label,
    detail: placeLabel && !sameArea(label, oblast?.name ?? found.oblast) ? (oblast?.name ?? found.oblast) : "уся область",
    oblastSlug: found.oblastSlug,
    oblastName: oblast?.name ?? found.oblast,
  })
}

function readRaw(): unknown {
  try {
    return JSON.parse(localStorage.getItem("cherga") ?? "null") as unknown
  } catch {
    return null
  }
}

async function copyText(url: string, button: HTMLButtonElement, idle: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    button.textContent = "Готово"
  } catch {
    link.value = url
    link.focus()
    link.select()
    button.textContent = "Виділіть"
  }
  window.setTimeout(() => {
    button.textContent = idle
  }, 1600)
}

function flash(text: string): void {
  status.textContent = text
  window.clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => {
    if (status.textContent === text) status.textContent = ""
  }, 1800)
}
