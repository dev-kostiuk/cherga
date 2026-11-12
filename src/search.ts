export interface PlacesFile {
  oblasts: { slug: string; name: string }[]
  raions: string[]
  hromadas: string[]
  places: [string, number, number, number, string][]
}

export interface PlaceHit {
  label: string
  detail: string
  oblastSlug: string
  oblastName: string
}

const KIND: Record<string, string> = {
  м: "місто",
  с: "село",
  щ: "селище",
  т: "смт",
}

export function normalize(value: string): string {
  return value
    .toLocaleLowerCase("uk")
    .replace(/['’ʼ`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

export function searchPlaces(file: PlacesFile, raw: string, limit = 12): PlaceHit[] {
  const query = normalize(raw)
  if (query.length < 2) return []
  const hits: Array<{ score: number; label: string; hit: PlaceHit }> = []

  file.oblasts.forEach((oblast) => {
    const name = normalize(oblast.name)
    if (!name.includes(query)) return
    hits.push({
      score: name.startsWith(query) ? 1 : 4,
      label: oblast.name,
      hit: {
        label: oblast.name,
        detail: "уся область",
        oblastSlug: oblast.slug,
        oblastName: oblast.name,
      },
    })
  })

  for (const place of file.places) {
    const [name, oblastIndex, raionIndex, hromadaIndex, kind] = place
    const normal = normalize(name)
    if (!normal.includes(query)) continue
    const oblast = file.oblasts[oblastIndex]
    if (!oblast) continue
    const exact = normal === query
    const prefix = normal.startsWith(query)
    const city = kind === "м"
    const score = exact ? (city ? 0 : 2) : prefix ? (city ? 1 : 3) : 5
    const raion = file.raions[raionIndex] ?? ""
    const hromada = file.hromadas[hromadaIndex] ?? ""
    const where = [raion, hromada && hromada !== raion ? hromada : ""].filter(Boolean).join(" · ")
    hits.push({
      score,
      label: name,
      hit: {
        label: name,
        detail: [KIND[kind] ?? "населений пункт", where].filter(Boolean).join(" · "),
        oblastSlug: oblast.slug,
        oblastName: oblast.name,
      },
    })
  }

  hits.sort((a, b) => a.score - b.score || a.label.length - b.label.length || a.label.localeCompare(b.label, "uk"))
  const seen = new Set<string>()
  const result: PlaceHit[] = []
  for (const hit of hits) {
    const key = `${hit.hit.oblastSlug}|${hit.hit.label}|${hit.hit.detail}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(hit.hit)
    if (result.length >= limit) break
  }
  return result
}
