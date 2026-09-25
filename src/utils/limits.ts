const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
// Shared secret the MCP server (actuent-private) sends so its calls aren't rate limited twice.
const INTERNAL_KEY = process.env.ACTUENT_INTERNAL_KEY

const SUPABASE_HEADERS = {
  "apikey": SUPABASE_SERVICE_KEY,
  "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json"
}

const keyCache = new Map<string, { valid: boolean, expires: number }>()

// A key is Pro only if it exists in Supabase api_keys and is active. Cached for 60s per instance.
export async function verifyApiKey(key: string): Promise<boolean> {
  if (!key) return false
  const cached = keyCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.valid
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/api_keys?select=id&key=eq.${encodeURIComponent(key)}&active=eq.true`,
      { headers: SUPABASE_HEADERS }
    )
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

const memoryLimits = new Map<string, number[]>()

// Used only if the Supabase hit_rate_limit function is unreachable.
function isRateLimitedInMemory(key: string, maxPerMinute: number): boolean {
  const now = Date.now()
  const timestamps = (memoryLimits.get(key) || []).filter(t => t > now - 60000)
  if (timestamps.length >= maxPerMinute) return true
  timestamps.push(now)
  memoryLimits.set(key, timestamps)
  return false
}

// Counts are stored in Supabase (rate_limits table) so limits hold across cold starts and instances.
export async function isRateLimited(key: string, maxPerMinute: number): Promise<boolean> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/hit_rate_limit`, {
      method: "POST",
      headers: SUPABASE_HEADERS,
      body: JSON.stringify({ k: key, max_per_minute: maxPerMinute })
    })
    if (!r.ok) return isRateLimitedInMemory(key, maxPerMinute)
    return (await r.json()) === true
  } catch {
    return isRateLimitedInMemory(key, maxPerMinute)
  }
}
