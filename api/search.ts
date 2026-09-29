import type { VercelRequest, VercelResponse } from "@vercel/node"
import { withoutHidden, searchSites } from "../src/utils/search"
import { verifyApiKey, bearerKey, isInternalCall, rateLimit, rateLimitHeaders, keyHash, isBlocked, strike, BLOCKED_MESSAGE, hitCounter, ipHash } from "../src/utils/limits"
import { isExecutable } from "../src/utils/native"
import { searchProducts } from "../src/utils/products"
import { trackedLink } from "../src/utils/links"
import { openNow } from "../src/utils/business"
import { notice, Notice, DEGRADED } from "../src/utils/notices"
import { later } from "../src/utils/later"
import { cleanQuery, cleanQueryKeepPrice, cacheKey, nearMe, wantsProducts } from "../src/utils/query"
import { cleanName, snippet, notAResult } from "../src/utils/results"
import { splitCity, cityCountry } from "../src/utils/local"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

async function trackSearch(query: string, domains: string[], tier: string, apiKey: string | null, durationMs?: number, resultCount?: number): Promise<void> {
  const send = (row: object) => fetch(`${SUPABASE_URL}/rest/v1/searches`, {
    method: "POST",
    headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(row)
  })
  try {
    const row = { query, domains, tier, api_key: apiKey ? keyHash(apiKey) : null }
    // duration_ms (list_seven.sql) feeds the search speed numbers on the ops page.
    // duration_ms and result_count (list_twelve.sql: zero-result searches on the ops page).
    const r = await send({ ...row, ...(durationMs != null ? { duration_ms: durationMs } : {}), ...(resultCount != null ? { result_count: resultCount } : {}) })
    if (!r.ok) { const r2 = await send(durationMs != null ? { ...row, duration_ms: durationMs } : row); if (!r2.ok && durationMs != null) await send(row) }
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

// Options (all optional): limit & offset (paging, max 50), category, city, lang, open_now=true,
// sort=relevance|popular|fresh. Applied to the finished result list, so cached searches can use them.
type Params = { limit?: number, offset: number, category?: string, city?: string, lang?: string, openNow: boolean, sort: "relevance" | "popular" | "fresh" }
function readParams(req: VercelRequest): Params {
  const v = (k: string) => { const x = req.method === "GET" ? req.query[k] : req.body?.[k]; return x == null ? undefined : String(x) }
  const n = (x?: string) => x != null && /^\d+$/.test(x) ? parseInt(x) : undefined
  const sort = v("sort")
  return {
    limit: n(v("limit")) != null ? Math.min(Math.max(n(v("limit"))!, 1), 50) : undefined, offset: Math.min(n(v("offset")) || 0, 500),
    category: v("category")?.toLowerCase().slice(0, 40), city: v("city")?.toLowerCase().slice(0, 60), lang: v("lang")?.toLowerCase().slice(0, 2),
    openNow: v("open_now") === "true", sort: sort === "popular" || sort === "fresh" ? sort : "relevance"
  }
}

function present(body: any, p: Params): any {
  let list: any[] = body.results || []
  if (p.category) list = list.filter(r => r.category === p.category)
  if (p.city) list = list.filter(r => String(r.business?.address?.city || "").toLowerCase() === p.city)
  if (p.openNow) list = list.filter(r => r.open_now === true)
  if (p.lang) list = [...list.filter(r => r.language === p.lang), ...list.filter(r => r.language !== p.lang)]
  if (p.sort === "popular") list = [...list].sort((a, b) => (a.popularity_rank || 1e9) - (b.popularity_rank || 1e9))
  if (p.sort === "fresh") list = [...list].sort((a, b) => Date.parse(b.last_updated || 0) - Date.parse(a.last_updated || 0))
  const filtered = list.length !== (body.results || []).length || p.sort !== "relevance"
  const total = list.length
  if (p.offset || p.limit) list = list.slice(p.offset, p.limit != null ? p.offset + p.limit : undefined)
  return { ...body, results: list, count: list.length, ...(filtered || p.offset || p.limit ? { total } : {}) }
}

// Event names saved straight from pages can still carry HTML entities ("&#8211;").
function decodeEntities(v: string): string {
  return String(v).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
}

// Upcoming events for event-style searches ("concerts copenhagen", "what's on in london").
const EVENTY = /\b(events?|concerts?|gigs?|what'?s on|festivals?|tonight|this weekend|shows?|exhibitions?|live music|comedy)\b/i
async function upcomingEvents(q: string): Promise<any[]> {
  if (!EVENTY.test(q)) return []
  const place = splitCity(q)
  const topic = (place?.what || q).replace(EVENTY, " ").replace(/\b(in|on|at|this|next|week|tonight)\b/gi, " ").replace(/\s+/g, " ").trim()
  const filters = [`start_date=gte.${encodeURIComponent(new Date().toISOString())}`]
  if (place) filters.push(`or=${encodeURIComponent(`(city.ilike.*${place.city.replace(/[*,()]/g, "")}*,venue.ilike.*${place.city.replace(/[*,()]/g, "")}*)`)}`)
  if (topic && topic.length >= 3) filters.push(`or=${encodeURIComponent(`(name.ilike.*${topic.replace(/[*,()]/g, "")}*,description.ilike.*${topic.replace(/[*,()]/g, "")}*)`)}`)
  if (!place && !(topic && topic.length >= 3)) return []
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_events?select=name,url,domain,start_date,end_date,venue,city,price,currency&${filters.join("&")}&order=start_date.asc&limit=12`, {
      headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }, signal: AbortSignal.timeout(2500)
    })
    const rows: any[] = r.ok ? await r.json() : []
    return rows.filter(e => !/\b(betting|odds|prediction|casino|bookmaker|prognoz)\b|прогноз|ставк/i.test(`${e.name} ${e.url}`)).slice(0, 5)
      .map(e => ({ ...e, name: decodeEntities(e.name), venue: e.venue ? decodeEntities(e.venue) : e.venue, visit_url: trackedLink(e.url) }))
  } catch { return [] }
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

  // What to search for: "near me" becomes the searcher's city, question-style searches become
  // keywords ("where can I buy running shoes in London?" → "buy running shoes london").
  const typed = query.trim()
  const localized = nearMe(typed, req.headers["x-vercel-ip-city"] as string | undefined)
  const searchQuery = cleanQuery(localized)
  const params = readParams(req)

  res.setHeader("X-Actuent-Tier", tier)
  // Signed-out GET searches can also be cached by Vercel's CDN; anything with a key is private,
  // and so is "near me" (the answer depends on where the searcher is).
  res.setHeader("Vary", "Authorization")
  res.setHeader("Cache-Control", req.method === "GET" && !apiKey && localized === typed
    ? "public, max-age=0, s-maxage=300, stale-while-revalidate=3600"
    : "private, no-store")

  // The price is part of the key: "shoes under 500 dkk" and "shoes" are different searches.
  const key = `${tier}:${cacheKey(cleanQueryKeepPrice(localized))}`
  const cached = cacheGet(key)
  if (cached) {
    await later(trackSearch(typed, (cached as any).results.map((r: any) => r.domain), tier, tier === "pro" && !isInternalCall(req.headers["x-actuent-internal"]) ? apiKey : null, Date.now() - requestStart, (cached as any).results.length))
    res.setHeader("X-Search-Time", String(Date.now() - requestStart))
    return res.status(200).json(present({ ...(cached as any), query: typed }, params))
  }

  // Products with prices run alongside site search for keyword queries ("running shoes under €100").
  const isDomainQuery = /^\S+\.[a-z]{2,}(\/\S*)?$/i.test(searchQuery)
  // Server-Timing shows where the time goes (sites vs products), for the ops page and debugging.
  const t0 = Date.now()
  let sitesMs = 0, productsMs = 0
  const timing: Record<string, number> = {}
  const notices: Notice[] = []
  const places: any[] = []
  const related: string[] = []
  // Scraper guard: one client running hundreds of free searches an hour (well past what a person
  // does) gets index-only results with a note, so real users and Pro keep the capacity.
  let lite = false
  if (tier === "free" && !isInternalCall(req.headers["x-actuent-internal"])) {
    const ip = (req.headers["x-forwarded-for"] as string || "unknown").split(",")[0].trim()
    // Never slows a search down: if the counter is slow to answer, the search goes ahead normally.
    const hourly = await Promise.race([hitCounter(`searches:${ipHash(ip)}`, 3600), new Promise<null>(r => setTimeout(() => r(null), 300))])
    lite = hourly !== null && hourly > FREE_SEARCHES_PER_HOUR
  }
  // Products only for searches that could be shopping, and never holding up the sites for long.
  // Products: the price stays in ("under 500 dkk"), the city goes, and shops in the shopper's
  // market (the city's country, or where the searcher is) rank first.
  const productPlace = splitCity(cleanQueryKeepPrice(localized))
  const productText = productPlace ? productPlace.what : cleanQueryKeepPrice(localized)
  const shopperCountry = cityCountry(productPlace?.city) || String(req.headers["x-vercel-ip-country"] || "").toLowerCase().slice(0, 2) || null
  const productSearch = isDomainQuery || !wantsProducts(searchQuery) ? Promise.resolve([]) : Promise.race([
    searchProducts(productText, tier, tier === "pro" ? 20 : 5, shopperCountry),
    new Promise<any[]>(r => setTimeout(() => r([]), 2500))
  ]).catch(() => [])
  const [results, products, events] = await Promise.all([
    searchSites(searchQuery, tier, timing, notices, { lite, places, related }).then(r => { sitesMs = Date.now() - t0; return r }),
    productSearch.then(r => { productsMs = Date.now() - t0; return r }),
    isDomainQuery ? Promise.resolve([]) : upcomingEvents(searchQuery)
  ])
  // Misspelt searches: suggest the closest well-known words (did_you_mean, list_eleven.sql), and
  // when nothing matched at all, search for the suggestion instead and say so.
  let didYouMean: string | null = null
  let searchedFor: string | null = null
  if (!isDomainQuery && results.length < 3) {
    didYouMean = await suggestSpelling(searchQuery)
    if (didYouMean && !results.length && !products.length) {
      const again = await searchSites(didYouMean, tier, timing, [], { lite })
      if (again.length) { results.push(...again); searchedFor = didYouMean }
    }
  }
  res.setHeader("Server-Timing", [`sites;dur=${sitesMs}`, `products;dur=${productsMs}`, ...Object.entries(timing).map(([k, v]) => `${k};dur=${v}`)].join(", "))
  // Adult and gambling sites are left out unless the query asks for them.
  // Error pages, bot checks and parked domains aren't results; www. and bare domains count once.
  const seenHost = new Set<string>()
  const shown = withoutHidden(results as any[], searchQuery).filter((r: any) => {
    if (notAResult(r)) return false
    const host = String(r.domain).replace(/^www\./, "")
    if (seenHost.has(host)) return false
    seenHost.add(host)
    return true
  })
  results.splice(0, results.length, ...shown)
  const domains = results.map(r => r.domain)

  // MCP calls are already logged per key by actuent-private, so don't attribute them to the key twice.
  const trackKey = tier === "pro" && !isInternalCall(req.headers["x-actuent-internal"]) ? apiKey : null
  await later(trackSearch(typed, domains, tier, trackKey, Date.now() - requestStart, results.length))

  if (searchedFor) notices.splice(0, notices.length, ...notices.filter(n => n.code !== "no_results" && n.code !== "busy_no_results"))
  if (!results.length && !products.length && !places.length && !notices.length) notices.push(notice("no_results", { query: typed }))
  const unique = notices.filter((n, i) => notices.findIndex(x => x.code === n.code) === i)
  const degraded = unique.some(n => DEGRADED.has(n.code))
  // Busy answers are counted, and the status banner (/api/status) turns on when there are many.
  if (unique.some(n => n.code.startsWith("busy"))) await later(hitCounter("busy", 300))

  // executable: the site publishes LAWP action endpoints agents can call via actuent_execute_action
  const now = Date.now()
  const topScore = Math.max(1e-9, ...results.map((r: any) => Number(r._score) || 0))
  const body = {
    query: typed,
    // The search that was actually run, when it differs from what was typed.
    ...(searchQuery !== typed ? { interpreted_as: searchQuery } : {}),
    count: results.length,
    results: results.map(({ contentHash, ownerKey, productsCrawledAt, rank, _score, ...r }: any, i: number) => ({
      ...r,
      name: cleanName(r.name, r.domain),
      // The sentence that best answers the search, and how strong the match is (0-100, top = 100).
      snippet: snippet(r, searchQuery),
      score: _score ? Math.max(1, Math.round((Number(_score) / topScore) * 100)) : Math.max(1, 100 - i * 5),
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
      visit_url: trackedLink(`https://${r.domain}`, typed)
    })),
    ...(products.length ? { products: products.map((p: any) => ({ ...p, visit_url: trackedLink(p.url) })) } : {}),
    // Local searches with no indexed websites yet: places from OpenStreetMap (not indexed sites).
    ...(places.length ? { places: { source: "OpenStreetMap", attribution: "© OpenStreetMap contributors, ODbL", items: places } } : {}),
    ...(events.length ? { events } : {}),
    ...(related.length ? { related } : {}),
    ...(didYouMean ? { did_you_mean: didYouMean } : {}),
    ...(searchedFor ? { searched_for: searchedFor } : {}),
    // What happened, in plain English, whenever results are limited or empty (docs.actuent.ai/#errors).
    ...(unique.length ? { notices: unique, message: unique[0].message } : {})
  }
  // A busy-time answer isn't cached anywhere: a retry a minute later should get the full search.
  if (degraded) res.setHeader("Cache-Control", "no-store")
  else if (results.length > 0 || products.length > 0) cacheSet(key, body)
  res.setHeader("X-Search-Time", String(Date.now() - requestStart))
  return res.status(200).json(present(body, params))
}