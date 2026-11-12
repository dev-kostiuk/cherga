import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { CATALOG } from "./catalog.ts"
import { type OperatorPlan, type Snapshot } from "./model.ts"
import { sleep } from "./net.ts"
import { failedOperator, fetchOperator, gapOperator, isLive } from "./sources.ts"

const root = join(import.meta.dirname, "..")
const target = join(root, "data", "schedules.json")

function signature(operators: OperatorPlan[]): string {
  return JSON.stringify(operators.map((operator) => ({ ...operator, fetchedAt: null })))
}

async function readPrevious(): Promise<Snapshot | null> {
  try {
    return JSON.parse(await readFile(target, "utf8")) as Snapshot
  } catch {
    return null
  }
}

const previous = await readPrevious()
const previousById = new Map(previous?.operators.map((operator) => [operator.id, operator]) ?? [])
const operators: OperatorPlan[] = []

for (const item of CATALOG) {
  if (!isLive(item.id)) {
    operators.push(gapOperator(item))
    continue
  }
  try {
    const next = await fetchOperator(item)
    operators.push(next)
    console.log(`${item.id}: ${next.queues.length} черг`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const kept = previousById.get(item.id)
    if (kept && kept.queues.length > 0) {
      operators.push(kept)
      console.log(`${item.id}: лишаю попередній графік (${message})`)
    } else {
      operators.push(failedOperator(item, error))
      console.log(`${item.id}: ${message}`)
    }
  }
  await sleep(300)
}

const snapshot: Snapshot = { generatedAt: new Date().toISOString(), operators }
if (previous && signature(previous.operators) === signature(operators)) {
  console.log("графіки без змін")
} else {
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`)
  console.log(`записано ${target}`)
}
