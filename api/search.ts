import type { VercelRequest, VercelResponse } from "@vercel/node"
import { searchSites } from "../src/utils/search"
import { verifyApiKey, bearerKey, isInternalCall, rateLimit, rateLimitHeaders, keyHash } from "../src/utils/limits"
import { isExecutable } from "../src/utils/native"
import { searchProducts } from "../src/utils/products"
import { openNow } from "../src/utils/business"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

async function trackSearch(query: string, domains: string[], tier: string, apiKey: string | null): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/searches`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, domains, tier, api_key: apiKey ? keyHash(apiKey) : null })
    })
  } catch {}
}

// Launch-day caching: identical searches within 60s reuse the result instead of re-running search,
// crawls and LLM calls. Separate entries per tier, so Pro never gets a free-tier result.
const RESULT_TTL_MS = 60_000
const resultCache = new Map<string, { body: unknown, expires: number }>()

function cacheGet(key: string): unknown | null {
  const hit = resultCache.get(key)
  if (hit && hit.expires > Date.now()) return hit.body
  if (hit) resultCache.delete(key)
  return null
}

function cacheSet(key: string, body: unknown) {
  resultCache.set(key, { body, expires: Date.now() + RESULT_TTL_MS })
  if (resultCache.size > 1000) resultCache.delete(resultCache.keys().next().value!)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

  if (req.method === "OPTIONS") return res.status(200).end()

  // Tier comes only from a valid API key in Supabase — never from a client-supplied header.
  const apiKey = bearerKey(req.headers["authorization"])
  const tier = await verifyApiKey(apiKey) ? "pro" : "free"
  const maxPerMinute = tier === "pro" ? 60 : 20

  // The MCP server rate limits its own users, so its calls skip this limit.
  if (!isInternalCall(req.headers["x-actuent-internal"])) {
    const ip = (req.headers["x-forwarded-for"] as string || "unknown").split(",")[0].trim()
    const limitKey = tier === "pro" ? `search:key:${keyHash(apiKey)}` : `search:ip:${ip}`
    const limit = await rateLimit(limitKey, maxPerMinute)
    rateLimitHeaders(res, limit)
    if (limit.limited) {
      res.setHeader("Cache-Control", "no-store")
      return res.status(429).json({
        error: "Rate limit exceeded",
        message: tier === "pro" ? "Pro: 60 req/min" : "Free: 20 req/min — upgrade at actuent.ai",
        retry_after_seconds: 60
      })
    }
  }

  const query = req.method === "GET"
    ? req.query.q as string
    : req.body?.query

  if (!query || typeof query !== "string" || query.trim() === "") {
    return res.status(400).json({ error: "Missing query" })
  }

  res.setHeader("X-Actuent-Tier", tier)
  // Signed-out GET searches can also be cached by Vercel's CDN; anything with a key is private.
  res.setHeader("Vary", "Authorization")
  res.setHeader("Cache-Control", req.method === "GET" && !apiKey
    ? "public, max-age=0, s-maxage=60, stale-while-revalidate=300"
    : "private, no-store")

  const cacheKey = `${tier}:${query.trim().toLowerCase()}`
  const cached = cacheGet(cacheKey)
  if (cached) {
    await trackSearch(query.trim(), (cached as any).results.map((r: any) => r.domain), tier, tier === "pro" && !isInternalCall(req.headers["x-actuent-internal"]) ? apiKey : null)
    return res.status(200).json({ ...(cached as any), query })
  }

  // Products with prices run alongside site search for keyword queries ("running shoes under €100").
  const isDomainQuery = /^\S+\.[a-z]{2,}(\/\S*)?$/i.test(query.trim())
  const [results, products] = await Promise.all([
    searchSites(query.trim(), tier),
    isDomainQuery ? Promise.resolve([]) : searchProducts(query.trim(), tier, tier === "pro" ? 20 : 5)
  ])
  const domains = results.map(r => r.domain)

  // MCP calls are already logged per key by actuent-private, so don't attribute them to the key twice.
  const trackKey = tier === "pro" && !isInternalCall(req.headers["x-actuent-internal"]) ? apiKey : null
  await trackSearch(query.trim(), domains, tier, trackKey)

  // executable: the site publishes LAWP action endpoints agents can call via actuent_execute_action
  const now = Date.now()
  const body = {
    query,
    count: results.length,
    results: results.map(({ contentHash, ownerKey, productsCrawledAt, ...r }: any) => ({
      ...r,
      native: !!r.native,
      executable: isExecutable(r),
      // Freshness: when this LAWP was last updated, so agents know how current it is.
      last_updated: r.updated_at || null,
      // Business details: open right now, in the business's own time zone (null when unknown).
      ...(r.business ? { open_now: openNow(r.business.opening_hours, r.business.address?.country) } : {}),
      age_hours: r.updated_at ? Math.max(0, Math.round((now - Date.parse(r.updated_at)) / 3600_000)) : null
    })),
    ...(products.length ? { products } : {})
  }
  if (results.length > 0 || products.length > 0) cacheSet(cacheKey, body)
  return res.status(200).json(body)
}