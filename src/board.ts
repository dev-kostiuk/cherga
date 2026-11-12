export interface Entry {
  operatorId: string
  queue: string
  label: string
  detail: string
  oblastSlug: string
  oblastName: string
}

export interface Board {
  entries: Entry[]
  focus: string | null
}

export interface PlaceGroup {
  key: string
  label: string
  operatorId: string
  oblastName: string
  entries: Entry[]
}

export function entryKey(entry: Pick<Entry, "operatorId" | "queue" | "label">): string {
  return `${entry.operatorId}\n${entry.queue}\n${entry.label}`
}

export function sameArea(label: string, oblast: string): boolean {
  return label === oblast || oblast.replace(/^м\.\s*/u, "") === label
}

export function addEntry(board: Board, entry: Entry): Board {
  const key = entryKey(entry)
  if (board.entries.some((item) => entryKey(item) === key)) return { entries: board.entries, focus: key }
  return { entries: [...board.entries, entry], focus: key }
}

export function focusEntry(board: Board, key: string): Board {
  if (!board.entries.some((item) => entryKey(item) === key)) return board
  return { ...board, focus: key }
}

export function removeEntry(board: Board, key: string): Board {
  const index = board.entries.findIndex((item) => entryKey(item) === key)
  if (index < 0) return board
  const entries = board.entries.filter((item) => entryKey(item) !== key)
  const focusStillThere = entries.some((item) => entryKey(item) === board.focus)
  if (board.focus !== key && focusStillThere) return { entries, focus: board.focus }
  const neighbor = entries[index] ?? entries[index - 1] ?? null
  return { entries, focus: neighbor ? entryKey(neighbor) : null }
}

export function groupEntries(entries: Entry[]): PlaceGroup[] {
  const groups: PlaceGroup[] = []
  for (const entry of entries) {
    const key = `${entry.operatorId}\n${entry.label}`
    let group = groups.find((item) => item.key === key)
    if (!group) {
      group = { key, label: entry.label, operatorId: entry.operatorId, oblastName: entry.oblastName, entries: [] }
      groups.push(group)
    }
    group.entries.push(entry)
  }
  return groups
}

export function normalizeStored(value: unknown): Board {
  if (!value || typeof value !== "object") return { entries: [], focus: null }
  const raw = value as Record<string, unknown>
  if (Array.isArray(raw.entries)) {
    const entries = raw.entries.filter(isEntry)
    const focus = typeof raw.focus === "string" && entries.some((item) => entryKey(item) === raw.focus)
      ? raw.focus
      : entries[0] ? entryKey(entries[0]) : null
    return { entries, focus }
  }
  if (isEntry(raw)) return { entries: [raw], focus: entryKey(raw) }
  return { entries: [], focus: null }
}

function isEntry(value: unknown): value is Entry {
  if (!value || typeof value !== "object") return false
  const item = value as Record<string, unknown>
  return typeof item.operatorId === "string" && item.operatorId.length > 0
    && typeof item.queue === "string" && item.queue.length > 0
    && typeof item.label === "string" && item.label.length > 0
    && typeof item.detail === "string"
    && typeof item.oblastSlug === "string"
    && typeof item.oblastName === "string"
}
