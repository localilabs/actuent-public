import crypto from "crypto"

// Shared by actuent-public and actuent-private (copied in both repos — keep them identical).

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
// Shared secret the MCP server (actuent-private) sends so its calls aren't rate limited twice.
const INTERNAL_KEY = process.env.ACTUENT_INTERNAL_KEY

const SUPABASE_HEADERS = {
  "apikey": SUPABASE_SERVICE_KEY,
  "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json"
}

// API keys are stored and looked up only as SHA-256 hashes (api_keys.key_hash, and every log table).
export function keyHash(key: string): string {
  return crypto.createHash("sha256").update(key, "utf8").digest("hex")
}

const keyCache = new Map<string, { valid: boolean, expires: number }>()

// A key is Pro only if it's in Supabase api_keys and active. Cached for 60s per instance.
export async function verifyApiKey(key: string): Promise<boolean> {
  if (!key) return false
  const cached = keyCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.valid
  try {
    // Extra keys made in Analytics (list_seven.sql) are only valid while their account's main key is.
    const withParent = await fetch(`${SUPABASE_URL}/rest/v1/api_keys?select=id,parent_key_hash&key_hash=eq.${keyHash(key)}&active=eq.true`, { headers: SUPABASE_HEADERS })
    if (withParent.ok) {
      const [row] = await withParent.json()
      let valid = !!row
      if (row?.parent_key_hash) {
        const p = await fetch(`${SUPABASE_URL}/rest/v1/api_keys?select=id&key_hash=eq.${row.parent_key_hash}&active=eq.true`, { headers: SUPABASE_HEADERS })
        valid = p.ok && (await p.json()).length > 0
      }
      keyCache.set(key, { valid, expires: Date.now() + 60000 })
      return valid
    }
    let r = await fetch(`${SUPABASE_URL}/rest/v1/api_keys?select=id&key_hash=eq.${keyHash(key)}&active=eq.true`, { headers: SUPABASE_HEADERS })
    // Before big_list.sql has run there's no key_hash column: fall back to the plain key.
    if (!r.ok) r = await fetch(`${SUPABASE_URL}/rest/v1/api_keys?select=id&key=eq.${encodeURIComponent(key)}&active=eq.true`, { headers: SUPABASE_HEADERS })
    if (!r.ok) return false
    const data = await r.json()
    const valid = Array.isArray(data) && data.length > 0
    keyCache.set(key, { valid, expires: Date.now() + 60000 })
    return valid
  } catch { return false }
}

export function bearerKey(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header
  return (value || "").replace(/^Bearer\s+/i, "").trim()
}

export function isInternalCall(header: string | string[] | undefined): boolean {
  const value = Array.isArray(header) ? header[0] : header
  return !!INTERNAL_KEY && value === INTERNAL_KEY
}

export type RateLimit = { limited: boolean, limit: number, remaining: number | null, reset: number }

const memoryLimits = new Map<string, number[]>()

// Used only if Supabase is unreachable.
function memoryCount(key: string): number {
  const now = Date.now()
  const timestamps = (memoryLimits.get(key) || []).filter(t => t > now - 60000)
  timestamps.push(now)
  memoryLimits.set(key, timestamps)
  return timestamps.length
}

// Per-minute counter in Supabase (rate_limits table), so limits hold across cold starts and instances.
export async function rateLimit(key: string, maxPerMinute: number): Promise<RateLimit> {
  const reset = 60 - new Date().getUTCSeconds()
  const result = (count: number | null, limited: boolean): RateLimit =>
    ({ limited, limit: maxPerMinute, remaining: count === null ? null : Math.max(0, maxPerMinute - count), reset })
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/hit_rate_limit_count`, {
      method: "POST", headers: SUPABASE_HEADERS, body: JSON.stringify({ k: key })
    })
    if (r.ok) {
      const count = Number(await r.json())
      return result(count, count > maxPerMinute)
    }
    // Before big_list.sql has run: the older boolean-only function.
    const old = await fetch(`${SUPABASE_URL}/rest/v1/rpc/hit_rate_limit`, {
      method: "POST", headers: SUPABASE_HEADERS, body: JSON.stringify({ k: key, max_per_minute: maxPerMinute })
    })
    if (old.ok) return result(null, (await old.json()) === true)
  } catch {}
  const count = memoryCount(key)
  return result(count, count > maxPerMinute)
}

export async function isRateLimited(key: string, maxPerMinute: number): Promise<boolean> {
  return (await rateLimit(key, maxPerMinute)).limited
}

// Standard rate-limit headers so agents can slow down before hitting 429.
export function rateLimitHeaders(res: { setHeader(name: string, value: string): unknown }, info: RateLimit) {
  res.setHeader("X-RateLimit-Limit", String(info.limit))
  if (info.remaining !== null) res.setHeader("X-RateLimit-Remaining", String(info.remaining))
  res.setHeader("X-RateLimit-Reset", String(info.reset))
  if (info.limited) res.setHeader("Retry-After", String(info.reset))
}

// ----- Abuse protection -----
// IPs are only ever stored as salted hashes. A client that keeps hitting its rate limit (30+
// refused requests in a minute) is blocked for an hour; blocks can also be added by hand in the
// blocked table. Checked on search, MCP, the LAWP checker and /go.

export function ipHash(ip: string): string {
  return crypto.createHash("sha256").update(`actuent-ip:${ip}`).digest("hex").slice(0, 32)
}

const blockCache = new Map<string, { blocked: boolean, expires: number }>()

export async function isBlocked(ip: string, key?: string): Promise<boolean> {
  const values = [ipHash(ip), ...(key ? [keyHash(key)] : [])]
  const fresh = values.map(v => blockCache.get(v)).filter(c => c && c.expires > Date.now())
  if (fresh.length === values.length) return fresh.some(c => c!.blocked)
  try {
    const list = encodeURIComponent(values.map(v => `"${v}"`).join(","))
    const r = await fetch(`${SUPABASE_URL}/rest/v1/blocked?select=value&value=in.(${list})&until=gt.${encodeURIComponent(new Date().toISOString())}`, { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(2000) })
    const hits = new Set<string>(r.ok ? (await r.json()).map((x: any) => x.value) : [])
    for (const v of values) blockCache.set(v, { blocked: hits.has(v), expires: Date.now() + 60000 })
    return hits.size > 0
  } catch { return false }
}

// Call when a request was refused for its rate limit.
export async function strike(ip: string, where: string): Promise<void> {
  try {
    if (!await isRateLimited(`strikes:${ipHash(ip)}`, 30)) return
    await fetch(`${SUPABASE_URL}/rest/v1/blocked?on_conflict=value`, {
      method: "POST", headers: { ...SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify({ kind: "ip", value: ipHash(ip), reason: `Kept exceeding the rate limit on ${where}`, until: new Date(Date.now() + 3600_000).toISOString(), created_at: new Date().toISOString() })
    })
    blockCache.set(ipHash(ip), { blocked: true, expires: Date.now() + 60000 })
  } catch {}
}

export const BLOCKED_MESSAGE = { error: "Blocked for too many requests. Try again in an hour, or email support@localilabs.com if this is a mistake." }

// ----- Longer counters (list_ten.sql) -----
// Counts in windows of any length: busy notices per 5 minutes (the "busy right now" banner) and
// free searches per IP per hour (the scraper guard). null when the counter isn't available.
export async function hitCounter(key: string, windowSeconds: number): Promise<number | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/hit_counter`, { method: "POST", headers: SUPABASE_HEADERS, body: JSON.stringify({ k: key, window_seconds: windowSeconds }), signal: AbortSignal.timeout(2000) })
    return r.ok ? Number(await r.json()) : null
  } catch { return null }
}

export async function peekCounter(key: string, windowSeconds: number): Promise<number | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/peek_counter`, { method: "POST", headers: SUPABASE_HEADERS, body: JSON.stringify({ k: key, window_seconds: windowSeconds }), signal: AbortSignal.timeout(2000) })
    return r.ok ? Number(await r.json()) : null
  } catch { return null }
}
