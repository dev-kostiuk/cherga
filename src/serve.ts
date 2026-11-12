import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, join, normalize } from "node:path"

const root = join(import.meta.dirname, "..", "site")
const port = Number(process.env.PORT ?? 4173)
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost")
  const path = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "")
  const file = join(root, path === "/" ? "index.html" : path)
  if (!file.startsWith(root)) {
    response.writeHead(403)
    response.end()
    return
  }
  try {
    const info = await stat(file)
    if (!info.isFile()) throw new Error("not a file")
    response.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-cache",
    })
    createReadStream(file).pipe(response)
  } catch {
    response.writeHead(404)
    response.end("Немає такого файлу")
  }
})

server.listen(port, () => {
  console.log(`http://localhost:${port}`)
})
