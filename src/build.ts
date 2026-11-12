import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Resvg } from "@resvg/resvg-js"
import * as esbuild from "esbuild"
import { type Snapshot } from "./model.ts"
import { renderWallpaper } from "./render.ts"

const root = join(import.meta.dirname, "..")
const site = join(root, "site")
const fonts = [
  join(root, "assets/fonts/NotoSans-Regular.ttf"),
  join(root, "assets/fonts/NotoSans-Medium.ttf"),
  join(root, "assets/fonts/NotoSans-SemiBold.ttf"),
]

await rm(site, { recursive: true, force: true })
await mkdir(join(site, "data"), { recursive: true })
await mkdir(join(site, "fonts"), { recursive: true })

await esbuild.build({
  entryPoints: [join(root, "src/web/main.ts")],
  bundle: true,
  outfile: join(site, "app.js"),
  format: "esm",
  target: "es2022",
  legalComments: "none",
})

await cp(join(root, "src/web/index.html"), join(site, "index.html"))
await cp(join(root, "src/web/styles.css"), join(site, "styles.css"))
await cp(join(root, "data/schedules.json"), join(site, "data/schedules.json"))
await cp(join(root, "data/places.json"), join(site, "data/places.json"))
for (const font of fonts) {
  await cp(font, join(site, "fonts", font.split("/").pop()!))
}
await writeFile(join(site, ".nojekyll"), "")

const snapshot = JSON.parse(await readFile(join(root, "data/schedules.json"), "utf8")) as Snapshot
const now = new Date()
let images = 0
for (const operator of snapshot.operators) {
  for (const queue of operator.queues) {
    const svg = renderWallpaper({
      place: operator.oblast,
      queue: queue.queue,
      source: operator.short,
      today: queue.today,
      tomorrow: queue.tomorrow,
      updated: queue.updated ?? operator.fetchedAt,
      now,
    })
    const png = new Resvg(svg, {
      font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: "Noto Sans" },
    })
      .render()
      .asPng()
    const directory = join(site, "w", operator.id)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, `${queue.queue}.png`), png)
    images += 1
  }
}

const written = await readdir(site)
console.log(`зібрано site/ (${written.join(", ")}), зображень: ${images}`)
