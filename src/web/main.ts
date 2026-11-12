import { addEntry, type Board, type Entry, entryKey, focusEntry, groupEntries, normalizeStored, removeEntry, sameArea } from "../board.ts"
import { type DayPlan, type OperatorPlan, type QueuePlan, SLOT_COUNT, type Snapshot, compareQueues, headline, kyivNow } from "../model.ts"
import { renderWallpaper } from "../render.ts"
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
const boardCount = document.querySelector<HTMLElement>("#board-count")!
const groupsEl = document.querySelector<HTMLElement>("#groups")!
const sheet = document.querySelector<HTMLElement>("#sheet")!
const sheetTitle = document.querySelector<HTMLElement>("#sheet-title")!
const phone = document.querySelector<HTMLElement>("#phone")!
const caption = document.querySelector<HTMLElement>("#caption")!
const link = document.querySelector<HTMLInputElement>("#link")!
const copy = document.querySelector<HTMLButtonElement>("#copy")!
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
otherPlace.addEventListener("click", () => {
  place = null
  operator = null
  query.value = ""
  queueFilter.value = ""
  render()
  query.focus()
})
copy.addEventListener("click", () => {
  if (link.value) void copyText(link.value, copy, "Скопіювати")
})

function render(): void {
  renderBoard()
  renderSearch()
  renderResults()
  renderPicker()
  renderSheet()
}

function renderSearch(): void {
  otherPlace.hidden = !place
  searchLabel.textContent = place ? "Обране місце" : board.entries.length > 0 ? "Додати ще місце" : "Місто, село або область"
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

  queueFilterLabel.hidden = queues.length <= 16
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

function onQueue(queueId: string): void {
  if (!place || !operator) return
  const entry = entryFrom(place, queueId)
  const key = entryKey(entry)
  const exists = board.entries.some((item) => entryKey(item) === key)
  board = exists ? focusEntry(board, key) : addEntry(board, entry)
  persist(entry)
  render()
  if (!exists) flash(`Додано: ${entry.label}, черга ${entry.queue}`)
}

function renderBoard(): void {
  const entries = board.entries
  empty.hidden = entries.length > 0
  boardEl.hidden = entries.length === 0
  boardCount.textContent = countLabel(entries.length)
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
      for (const entry of group.entries) section.append(renderRow(entry))
      return section
    }),
  )
}

function renderRow(entry: Entry): HTMLElement {
  const resolved = resolve(entry)
  const row = document.createElement("div")
  row.className = "row"
  const focused = entryKey(entry) === board.focus
  if (focused) row.classList.add("is-focus")

  const open = document.createElement("button")
  open.type = "button"
  open.className = "row-open"
  const minutes = kyivNow(new Date()).minutes
  const state = resolved.plan ? headline(resolved.plan.today, minutes) : null
  open.append(dot(state?.tone ?? "wait"))
  const title = document.createElement("span")
  title.className = "row-title"
  const strong = document.createElement("strong")
  strong.textContent = entry.queue
  title.append(strong)
  if (focused) {
    const tag = document.createElement("em")
    tag.className = "screen-tag"
    tag.textContent = "На екрані"
    title.append(tag)
  }
  const line = document.createElement("span")
  line.className = "row-status"
  line.textContent = state ? `${state.title} · ${state.sub}` : "Цієї черги зараз немає в графіку"
  open.append(title, line)
  if (resolved.plan && resolved.plan.today.slots.length === SLOT_COUNT) {
    const bars = document.createElement("span")
    bars.className = "bars"
    bars.append(barLine("Сьогодні", resolved.plan.today))
    if (resolved.plan.tomorrow.slots.length === SLOT_COUNT) bars.append(barLine("Завтра", resolved.plan.tomorrow))
    else {
      const later = document.createElement("span")
      later.className = "tomorrow-note"
      later.textContent = resolved.plan.tomorrow.status === "emergency" ? "Завтра аварійні відключення" : "Завтра графік ще не опубліковано"
      bars.append(later)
    }
    open.append(bars)
  }
  open.addEventListener("click", () => selectEntry(entry))

  const actions = document.createElement("div")
  actions.className = "row-actions"
  const copyButton = document.createElement("button")
  copyButton.type = "button"
  copyButton.className = "ghost"
  copyButton.textContent = "Копіювати"
  copyButton.setAttribute("aria-label", `Скопіювати посилання, ${entry.label}, черга ${entry.queue}`)
  copyButton.addEventListener("click", () => {
    void copyEntry(entry, copyButton)
  })
  const removeButton = document.createElement("button")
  removeButton.type = "button"
  removeButton.className = "ghost icon"
  removeButton.textContent = "×"
  removeButton.setAttribute("aria-label", `Прибрати ${entry.label}, черга ${entry.queue}`)
  removeButton.addEventListener("click", () => remove(entry))
  actions.append(copyButton, removeButton)
  row.append(open, actions)
  return row
}

function selectEntry(entry: Entry): void {
  board = focusEntry(board, entryKey(entry))
  openEntry(entry)
  persist(entry)
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
  persist(next)
  render()
}

function renderSheet(): void {
  const entry = board.entries.find((item) => entryKey(item) === board.focus) ?? null
  const resolved = entry ? resolve(entry) : null
  const plan = resolved?.plan ?? null
  const current = resolved?.operator ?? null
  sheet.hidden = !entry || !plan || !current
  if (!entry || !plan || !current) return
  const several = (snapshot?.operators.filter((item) => item.oblastSlug === entry.oblastSlug).length ?? 0) > 1
  sheetTitle.textContent = several ? `${entry.label} · ${current.short} · ${entry.queue}` : `${entry.label} · черга ${entry.queue}`
  caption.textContent = sameArea(entry.label, current.oblast) ? "" : `${entry.label} · той самий графік, що й ${current.oblast}.`
  phone.innerHTML = renderWallpaper({
    place: current.oblast,
    queue: plan.queue,
    source: current.short,
    today: plan.today,
    tomorrow: plan.tomorrow,
    updated: plan.updated ?? current.fetchedAt,
  })
  link.value = wallpaperUrl(entry)
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

function barLine(label: string, day: DayPlan): HTMLElement {
  const line = document.createElement("span")
  line.className = "bar-line"
  const name = document.createElement("span")
  name.className = "bar-label"
  name.textContent = label
  const bar = document.createElement("span")
  bar.className = "bar"
  bar.setAttribute("aria-hidden", "true")
  for (const slot of day.slots) {
    const cell = document.createElement("span")
    cell.className = slot === 0 ? "on" : slot === 2 ? "maybe" : "off"
    bar.append(cell)
  }
  line.append(name, bar)
  return line
}

function wallpaperUrl(entry: Entry): string {
  return new URL(`w/${entry.operatorId}/${entry.queue}.png`, document.baseURI).href
}

function persist(entry: Entry | null): void {
  localStorage.setItem("cherga", JSON.stringify(board))
  const next = new URL(document.baseURI)
  if (entry) {
    next.searchParams.set("o", entry.operatorId)
    next.searchParams.set("q", entry.queue)
    next.searchParams.set("p", entry.label)
  }
  const current = `${location.pathname}${location.search}`
  const target = `${next.pathname}${next.search}`
  if (current !== target) history.replaceState(null, "", next)
}

function restore(): void {
  board = normalizeStored(readRaw())
  const params = new URLSearchParams(location.search)
  const operatorId = params.get("o")
  const queueId = params.get("q")
  const placeLabel = params.get("p")
  if (operatorId && queueId && snapshot && places) {
    const found = snapshot.operators.find((item) => item.id === operatorId)
    if (found?.queues.some((item) => item.queue === queueId)) {
      const oblast = places.oblasts.find((item) => item.slug === found.oblastSlug)
      const matches = board.entries.filter((item) => item.operatorId === operatorId && item.queue === queueId)
      const existing = placeLabel ? matches.find((item) => item.label === placeLabel) : matches[0]
      if (existing) {
        board = focusEntry(board, entryKey(existing))
      } else {
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
    }
  }
  const focused = board.entries.find((item) => entryKey(item) === board.focus) ?? null
  if (focused) openEntry(focused)
  persist(focused)
  render()
}

function readRaw(): unknown {
  try {
    return JSON.parse(localStorage.getItem("cherga") ?? "null") as unknown
  } catch {
    return null
  }
}

function countLabel(count: number): string {
  const mod100 = count % 100
  const mod10 = count % 10
  const word = mod10 === 1 && mod100 !== 11 ? "черга" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "черги" : "черг"
  return `${count} ${word}`
}

async function copyEntry(entry: Entry, button: HTMLButtonElement): Promise<void> {
  const focused = entryKey(entry) === board.focus
  if (!focused) selectEntry(entry)
  const target = focused ? button : copy
  const idle = focused ? "Копіювати" : "Скопіювати"
  try {
    await navigator.clipboard.writeText(wallpaperUrl(entry))
    target.textContent = "Готово"
  } catch {
    link.value = wallpaperUrl(entry)
    link.focus()
    link.select()
    target.textContent = "Виділіть"
  }
  window.setTimeout(() => {
    target.textContent = idle
  }, 1600)
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
