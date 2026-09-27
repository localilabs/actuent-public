import type { VercelRequest, VercelResponse } from "@vercel/node"
import { withoutHidden, searchSites } from "../src/utils/search"
import { verifyApiKey, bearerKey, isInternalCall, rateLimit, rateLimitHeaders, keyHash, isBlocked, strike, BLOCKED_MESSAGE, hitCounter, ipHash } from "../src/utils/limits"
import { isExecutable } from "../src/utils/native"
import { searchProducts } from "../src/utils/products"
import { trackedLink } from "../src/utils/links"
import { openNow } from "../src/utils/business"
import { notice, Notice, DEGRADED } from "../src/utils/notices"
import { later } from "../src/utils/later"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

async function trackSearch(query: string, domains: string[], tier: string, apiKey: string | null, durationMs?: number): Promise<void> {
  const send = (row: object) => fetch(`${SUPABASE_URL}/rest/v1/searches`, {
    method: "POST",
    headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(row)
  })
  try {
    const row = { query, domains, tier, api_key: apiKey ? keyHash(apiKey) : null }
    // duration_ms (list_seven.sql) feeds the search speed numbers on the ops page.
    const r = await send(durationMs != null ? { ...row, duration_ms: durationMs } : row)
    if (!r.ok && durationMs != null) await send(row)
  } catch {}
}

// Launch-day caching: identical searches within 60s reuse the result instead of re-running search,
// crawls and LLM calls. Separate entries per tier, so Pro never gets a free-tier result.
const RESULT_TTL_MS = 60_000
// Past this many free searches from one client in an hour, results are index-only (scraper guard).
const FREE_SEARCHES_PER_HOUR = parseInt(process.env.FREE_SEARCHES_PER_HOUR || "300")
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

async function suggestSpelling(q: string): Promise<string | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/did_you_mean`, {
      method: "POST", headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ q }), signal: AbortSignal.timeout(1500)
    })
    const s = r.ok ? await r.json() : null
    return typeof s === "string" && s && s !== q.toLowerCase() ? s : null
  } catch { return null }
}

// Never an empty 500: anything unexpected (overloaded database, timeouts) becomes a 503 with a
// plain-English message and Retry-After, so people and agents know to try again shortly.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    return await search(req, res)
  } catch (e) {
    console.error("search failed:", e)
    if (res.headersSent) return
    const n = notice("busy", { retryAfter: 60 })
    res.setHeader("Cache-Control", "no-store")
    res.setHeader("Retry-After", "60")
    return res.status(503).json({ error: "busy", message: n.message, retry_after_seconds: 60, count: 0, results: [], notices: [n] })
  }
}

async function search(req: VercelRequest, res: VercelResponse) {
  const requestStart = Date.now()
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
    if (await isBlocked(ip, tier === "pro" ? apiKey : undefined)) { res.setHeader("Cache-Control", "no-store"); return res.status(403).json(BLOCKED_MESSAGE) }
    const limitKey = tier === "pro" ? `search:key:${keyHash(apiKey)}` : `search:ip:${ip}`
    const limit = await rateLimit(limitKey, maxPerMinute)
    rateLimitHeaders(res, limit)
    if (limit.limited) {
      await strike(ip, "search")
      res.setHeader("Cache-Control", "no-store")
      return res.status(429).json({
        error: "Rate limit exceeded",
        message: tier === "pro"
          ? `You're sending searches faster than Actuent Pro allows (60 a minute). Please wait ${limit.reset} seconds and try again.`
          : `You're sending searches faster than the free plan allows (20 a minute). Please wait ${limit.reset} seconds, or get Actuent Pro at actuent.ai for 60 a minute and priority when it's busy.`,
        retry_after_seconds: limit.reset
      })
    }
  }

  const query = req.method === "GET"
    ? req.query.q as string
    : req.body?.query

  if (!query || typeof query !== "string" || query.trim() === "") {
    return res.status(400).json({ error: "Missing query" })
  }
  // Searches are a few words; very long input only costs CPU (ranking, translation, full-text search).
  if (query.length > 500) return res.status(400).json({ error: "Query too long", message: "Keep searches under 500 characters." })

  res.setHeader("X-Actuent-Tier", tier)
  // Signed-out GET searches can also be cached by Vercel's CDN; anything with a key is private.
  res.setHeader("Vary", "Authorization")
  res.setHeader("Cache-Control", req.method === "GET" && !apiKey
    ? "public, max-age=0, s-maxage=300, stale-while-revalidate=3600"
    : "private, no-store")

  const cacheKey = `${tier}:${query.trim().toLowerCase()}`
  const cached = cacheGet(cacheKey)
  if (cached) {
    await later(trackSearch(query.trim(), (cached as any).results.map((r: any) => r.domain), tier, tier === "pro" && !isInternalCall(req.headers["x-actuent-internal"]) ? apiKey : null, Date.now() - requestStart))
    return res.status(200).json({ ...(cached as any), query })
  }

  // Products with prices run alongside site search for keyword queries ("running shoes under €100").
  const isDomainQuery = /^\S+\.[a-z]{2,}(\/\S*)?$/i.test(query.trim())
  // Server-Timing shows where the time goes (sites vs products), for the ops page and debugging.
  const t0 = Date.now()
  let sitesMs = 0, productsMs = 0
  const timing: Record<string, number> = {}
  const notices: Notice[] = []
  const places: any[] = []
  // Scraper guard: one client running hundreds of free searches an hour (well past what a person
  // does) gets index-only results with a note, so real users and Pro keep the capacity.
  let lite = false
  if (tier === "free" && !isInternalCall(req.headers["x-actuent-internal"])) {
    const ip = (req.headers["x-forwarded-for"] as string || "unknown").split(",")[0].trim()
    // Never slows a search down: if the counter is slow to answer, the search goes ahead normally.
    const hourly = await Promise.race([hitCounter(`searches:${ipHash(ip)}`, 3600), new Promise<null>(r => setTimeout(() => r(null), 300))])
    lite = hourly !== null && hourly > FREE_SEARCHES_PER_HOUR
  }
  const [results, products] = await Promise.all([
    searchSites(query.trim(), tier, timing, notices, { lite, places }).then(r => { sitesMs = Date.now() - t0; return r }),
    (isDomainQuery ? Promise.resolve([]) : searchProducts(query.trim(), tier, tier === "pro" ? 20 : 5)).then(r => { productsMs = Date.now() - t0; return r })
  ])
  // Misspelt searches: suggest the closest well-known words (did_you_mean, list_eleven.sql), and
  // when nothing matched at all, search for the suggestion instead and say so.
  let didYouMean: string | null = null
  let searchedFor: string | null = null
  if (!isDomainQuery && results.length < 3) {
    didYouMean = await suggestSpelling(query.trim())
    if (didYouMean && !results.length && !products.length) {
      const again = await searchSites(didYouMean, tier, timing, [], { lite })
      if (again.length) { results.push(...again); searchedFor = didYouMean }
    }
  }
  res.setHeader("Server-Timing", [`sites;dur=${sitesMs}`, `products;dur=${productsMs}`, ...Object.entries(timing).map(([k, v]) => `${k};dur=${v}`)].join(", "))
  // Adult and gambling sites are left out unless the query asks for them.
  const shown = withoutHidden(results as any[], query)
  results.splice(0, results.length, ...shown)
  const domains = results.map(r => r.domain)

  // MCP calls are already logged per key by actuent-private, so don't attribute them to the key twice.
  const trackKey = tier === "pro" && !isInternalCall(req.headers["x-actuent-internal"]) ? apiKey : null
  await later(trackSearch(query.trim(), domains, tier, trackKey, Date.now() - requestStart))

  if (searchedFor) notices.splice(0, notices.length, ...notices.filter(n => n.code !== "no_results" && n.code !== "busy_no_results"))
  if (!results.length && !products.length && !places.length && !notices.length) notices.push(notice("no_results", { query: query.trim() }))
  const unique = notices.filter((n, i) => notices.findIndex(x => x.code === n.code) === i)
  const degraded = unique.some(n => DEGRADED.has(n.code))
  // Busy answers are counted, and the status banner (/api/status) turns on when there are many.
  if (unique.some(n => n.code.startsWith("busy"))) await later(hitCounter("busy", 300))

  // executable: the site publishes LAWP action endpoints agents can call via actuent_execute_action
  const now = Date.now()
  const body = {
    query,
    count: results.length,
    results: results.map(({ contentHash, ownerKey, productsCrawledAt, rank, ...r }: any) => ({
      ...r,
      native: !!r.native,
      executable: isExecutable(r),
      // Why this result: which words matched where (search.ts explainMatch).
      matched: r.matched || (isDomainQuery ? "exact domain" : undefined),
      // Freshness: when this LAWP was last updated, so agents know how current it is.
      last_updated: r.updated_at || null,
      // Business details: open right now, in the business's own time zone (null when unknown).
      ...(r.business ? { open_now: openNow(r.business.opening_hours, r.business.address?.country) } : {}),
      age_hours: r.updated_at ? Math.max(0, Math.round((now - Date.parse(r.updated_at)) / 3600_000)) : null,
      // Give this link to the user: it lets the site's owner see visits that came from AI agents.
      visit_url: trackedLink(`https://${r.domain}`, query.trim())
    })),
    ...(products.length ? { products: products.map((p: any) => ({ ...p, visit_url: trackedLink(p.url) })) } : {}),
    // Local searches with no indexed websites yet: places from OpenStreetMap (not indexed sites).
    ...(places.length ? { places: { source: "OpenStreetMap", attribution: "© OpenStreetMap contributors, ODbL", items: places } } : {}),
    ...(didYouMean ? { did_you_mean: didYouMean } : {}),
    ...(searchedFor ? { searched_for: searchedFor } : {}),
    // What happened, in plain English, whenever results are limited or empty (docs.actuent.ai/#errors).
    ...(unique.length ? { notices: unique, message: unique[0].message } : {})
  }
  // A busy-time answer isn't cached anywhere: a retry a minute later should get the full search.
  if (degraded) res.setHeader("Cache-Control", "no-store")
  else if (results.length > 0 || products.length > 0) cacheSet(cacheKey, body)
  return res.status(200).json(body)
}