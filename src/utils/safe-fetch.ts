import { promises as dns } from "dns"
import net from "net"

// Security (SSRF): fetch only public addresses, following redirects one hop at a time and checking
// each hop, so a crawled site can't point Actuent at internal or cloud-metadata addresses.
// Shared by actuent-public (src/utils/safe-fetch.ts) and actuent-crawler (safe-fetch.ts) — copied, keep in sync.

function isPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  const v6 = ip.toLowerCase()
  if (v6.startsWith("::ffff:")) return isPrivate(v6.slice(7))
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80")
}

const verdicts = new Map<string, { ok: boolean, expires: number }>()
export async function isPublicHost(host: string): Promise<boolean> {
  const cached = verdicts.get(host)
  if (cached && cached.expires > Date.now()) return cached.ok
  let ok = false
  try {
    const addresses = await dns.lookup(host, { all: true })
    ok = addresses.length > 0 && addresses.every(a => !isPrivate(a.address))
  } catch {}
  verdicts.set(host, { ok, expires: Date.now() + 300_000 })
  if (verdicts.size > 5000) verdicts.clear()
  return ok
}

export async function fetchPublic(url: string, init: RequestInit = {}, maxHops = 5): Promise<Response | null> {
  let current = url
  for (let hop = 0; hop <= maxHops; hop++) {
    let u: URL
    try { u = new URL(current) } catch { return null }
    if (!/^https?:$/.test(u.protocol) || !await isPublicHost(u.hostname)) return null
    const res = await fetch(u, { ...init, redirect: "manual" })
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null
    if (!location) { Object.defineProperty(res, "url", { value: u.toString() }); return res }
    current = new URL(location, u).toString()
  }
  return null
}
