const USER_AGENT = "cherga/0.1 (lock-screen outage schedule; infrequent, one pass)"

export async function getBytes(url: string, init: RequestInit = {}): Promise<Uint8Array> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(25_000),
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/json, text/html, application/xml;q=0.9, */*;q=0.8",
      ...init.headers,
    },
  })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > 5_000_000) throw new Error(`завелика відповідь ${url}`)
  return bytes
}

export async function getText(url: string, init: RequestInit = {}): Promise<string> {
  return new TextDecoder("utf-8").decode(await getBytes(url, init))
}

export function decodeWindows1251(bytes: Uint8Array): string {
  return new TextDecoder("windows-1251").decode(bytes)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
