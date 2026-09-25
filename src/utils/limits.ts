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
