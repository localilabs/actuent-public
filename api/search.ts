import type { VercelRequest, VercelResponse } from "@vercel/node"
import { withoutHidden, searchSites, quickSearch, isPlaceSearch } from "../src/utils/search"
import { verifyApiKey, bearerKey, isInternalCall, rateLimit, rateLimitHeaders, keyHash, isBlocked, strike, BLOCKED_MESSAGE, hitCounter, ipHash } from "../src/utils/limits"
import { isExecutable } from "../src/utils/native"
import { searchProducts } from "../src/utils/products"
import { trackedLink } from "../src/utils/links"
import { openNow } from "../src/utils/business"
import { notice, Notice, DEGRADED } from "../src/utils/notices"
import { later } from "../src/utils/later"
import { cleanQuery, cleanQueryKeepPrice, cacheKey, nearMe, wantsProducts } from "../src/utils/query"
import { cleanName, snippet, notAResult, nearlyEmpty } from "../src/utils/results"
import { splitCity, cityCountry } from "../src/utils/local"
import { comparison, comparisonSides, questionSite, answerFromSite } from "../src/utils/answer"
import { answerSummary, QUESTION } from "../src/utils/summary"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

// The search log is written in batches: the first search starts a 5-second timer, and every search
// that arrives meanwhile goes in the same insert (one database write for a burst of searches). The
// timer runs after the response (later/waitUntil), so nothing is lost when the server goes idle.
const logBuffer: any[] = []
async function flushSearchLog(): Promise<void> {
  const rows = logBuffer.splice(0, logBuffer.length)
  if (!rows.length) return
  const send = (body: object[]) => fetch(`${SUPABASE_URL}/rest/v1/searches`, {
    method: "POST",
    headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000)
  })
  try {
    const r = await send(rows)
    // Older databases without duration_ms/result_count (list_seven/list_twelve.sql): the basic columns.
    if (!r.ok) await send(rows.map(({ duration_ms, result_count, ...basic }) => basic))
  } catch {}
}
async function trackSearch(query: string, domains: string[], tier: string, apiKey: string | null, durationMs?: number, resultCount?: number): Promise<void> {
  // Same columns in every row: a batch insert needs them to match.
  logBuffer.push({ query, domains, tier, api_key: apiKey ? keyHash(apiKey) : null, duration_ms: durationMs ?? null, result_count: resultCount ?? null })
  if (logBuffer.length >= 25) return flushSearchLog()
  if (logBuffer.length === 1) { await new Promise(r => setTimeout(r, 5000)); return flushSearchLog() }
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
// sort=relevance|popular|fresh|rating. Applied to the finished result list, so cached searches can use them.
type Params = { limit?: number, offset: number, category?: string, city?: string, lang?: string, openNow: boolean, sort: "relevance" | "popular" | "fresh" | "rating" }
function readParams(req: VercelRequest): Params {
  const v = (k: string) => { const x = req.method === "GET" ? req.query[k] : req.body?.[k]; return x == null ? undefined : String(x) }
  const n = (x?: string) => x != null && /^\d+$/.test(x) ? parseInt(x) : undefined
  const sort = v("sort")
  return {
    limit: n(v("limit")) != null ? Math.min(Math.max(n(v("limit"))!, 1), 50) : undefined, offset: Math.min(n(v("offset")) || 0, 500),
    category: v("category")?.toLowerCase().slice(0, 40), city: v("city")?.toLowerCase().slice(0, 60), lang: v("lang")?.toLowerCase().slice(0, 2),
    openNow: v("open_now") === "true", sort: sort === "popular" || sort === "fresh" || sort === "rating" ? sort : "relevance"
  }
}

function present(body: any, p: Params): any {
  let list: any[] = body.results || []
  if (p.category) list = list.filter(r => r.category === p.category)
  if (p.city) list = list.filter(r => String(r.business?.address?.city || "").toLowerCase() === p.city)
  if (p.openNow) list = list.filter(r => r.open_now === true)
  if (p.lang) list = [...list.filter(r => r.language === p.lang), ...list.filter(r => r.language !== p.lang)]
  if (p.sort === "popular") list = [...list].sort((a, b) => (a.popularity_rank || 1e9) - (b.popularity_rank || 1e9))
  // Best rated first (5-point ratings from the sites' own pages); unrated ones keep their order after.
  if (p.sort === "rating") list = [...list].sort((a, b) => (Number(b.business?.rating?.value) || 0) - (Number(a.business?.rating?.value) || 0))
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

// A client searching again within 90 seconds with overlapping words is refining the search.
const lastSearch = new Map<string, { q: string, at: number }>()
function noteReformulation(client: string, q: string) {
  const prev = lastSearch.get(client)
  lastSearch.set(client, { q, at: Date.now() })
  if (lastSearch.size > 5000) lastSearch.delete(lastSearch.keys().next().value!)
  if (!prev || Date.now() - prev.at > 90_000 || prev.q.toLowerCase() === q.toLowerCase()) return
  const a = new Set(prev.q.toLowerCase().split(/\s+/)), overlap = q.toLowerCase().split(/\s+/).some(w => w.length > 2 && a.has(w))
  if (!overlap || /[@/:]|\d{4,}/.test(prev.q + q)) return
  later(fetch(`${SUPABASE_URL}/rest/v1/rpc/add_reformulation`, {
    method: "POST", headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ a: prev.q, b: q }), signal: AbortSignal.timeout(3000)
  }))
}
async function usualRewrites(q: string): Promise<string[]> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/query_reformulations?select=to_query&from_query=eq.${encodeURIComponent(q.toLowerCase().slice(0, 120))}&times=gte.3&order=times.desc&limit=3`, {
      headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }, signal: AbortSignal.timeout(500)
    })
    return r.ok ? (await r.json()).map((x: any) => x.to_query) : []
  } catch { return [] }
}

// Shared cache: popular searches answer from here on every server instance (30 minutes).
const SHARED_TTL_MS = 30 * 60_000
async function sharedCacheGet(key: string): Promise<unknown | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/search_cache?select=body&key=eq.${encodeURIComponent(key)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`, {
      headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }, signal: AbortSignal.timeout(400)
    })
    const [row] = r.ok ? await r.json() : []
    return row?.body ?? null
  } catch { return null }
}
async function sharedCacheSet(key: string, body: unknown): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/search_cache?on_conflict=key`, {
    method: "POST",
    headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ key, body, expires_at: new Date(Date.now() + SHARED_TTL_MS).toISOString() }),
    signal: AbortSignal.timeout(3000)
  }).catch(() => {})
  // Now and then, expired answers are deleted, so the cache never grows much (each is ~100 KB and
  // the free database has 500 MB). Uses the expires_at index.
  if (Math.random() < 0.05) {
    await fetch(`${SUPABASE_URL}/rest/v1/search_cache?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, {
      method: "DELETE", headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`, "Prefer": "return=minimal" }, signal: AbortSignal.timeout(3000)
    }).catch(() => {})
  }
}

// Each client's last searched city, for an hour (in memory, hashed client key only).
const cities = new Map<string, { city: string, at: number }>()
function rememberCity(client: string, city: string) {
  cities.set(client, { city, at: Date.now() })
  if (cities.size > 5000) cities.delete(cities.keys().next().value!)
}
function recentCity(client: string): string | null {
  const c = cities.get(client)
  return c && Date.now() - c.at < 3600_000 ? c.city : null
}
function headerCity(h: string | undefined): string | null {
  if (!h) return null
  try { const c = decodeURIComponent(h); return /^[\p{L}\s.'-]{2,40}$/u.test(c) ? c : null } catch { return null }
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
  // Signed-out GET searches can also be cached by Vercel's CDN for 15 minutes (a new deploy clears
  // it); anything with a key is private,
  // and so is "near me" (the answer depends on where the searcher is).
  // So is a search for places without a city ("cafés"): it favours the searcher's own city.
  const clientKey = ipHash((req.headers["x-forwarded-for"] as string || "unknown").split(",")[0].trim())
  const searchedCity = splitCity(searchQuery)?.city
  if (searchedCity) rememberCity(clientKey, searchedCity)
  const placeSearch = isPlaceSearch(searchQuery)
  const homeCity = placeSearch ? recentCity(clientKey) || headerCity(req.headers["x-vercel-ip-city"] as string | undefined) : null
  res.setHeader("Vary", "Authorization")
  res.setHeader("Cache-Control", req.method === "GET" && !apiKey && localized === typed && !placeSearch
    ? "public, max-age=0, s-maxage=900, stale-while-revalidate=3600"
    : "private, no-store")

  // The price is part of the key: "shoes under 500 dkk" and "shoes" are different searches.
  // The deploy is part of it too, so a fix shows up straight away instead of after the cache expires.
  const key = `${tier}:${(process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7)}:${cacheKey(cleanQueryKeepPrice(localized))}${homeCity ? `@${homeCity.toLowerCase()}` : ""}`
  // This instance's memory first, then the shared cache every instance writes (list_thirteen.sql).
  // (A memory hit isn't stored again: that would keep an old answer alive for as long as people ask.)
  const inMemory = cacheGet(key)
  const cached = inMemory ?? await sharedCacheGet(key)
  if (cached) {
    if (!inMemory) cacheSet(key, cached)
    await later(trackSearch(typed, (cached as any).results.map((r: any) => r.domain), tier, tier === "pro" && !isInternalCall(req.headers["x-actuent-internal"]) ? apiKey : null, Date.now() - requestStart, (cached as any).results.length))
    res.setHeader("X-Search-Time", String(Date.now() - requestStart))
    return res.status(200).json(present({ ...(cached as any), query: typed }, params))
  }

  // fast=1: a quick first answer (best-known sites, exact name, local businesses) while the full
  // search runs; the humans page asks for both. Not cached, not counted as a search.
  if (req.query?.fast === "1" && req.method === "GET") {
    const quick = withoutHidden(await quickSearch(searchQuery).catch(() => []) as any[], searchQuery).filter((r: any) => !notAResult(r))
    res.setHeader("Cache-Control", "private, no-store")
    return res.status(200).json({
      query: typed, partial: true, count: quick.length,
      results: quick.map(({ ownerKey, rank, ...r }: any) => ({
        ...r, name: cleanName(r.name, r.domain), snippet: snippet(r, searchQuery), native: !!r.native, executable: isExecutable(r),
        ...(r.business ? { open_now: openNow(r.business.opening_hours, r.business.address?.country, new Date(), r.business.special_hours) } : {}),
        visit_url: trackedLink(`https://${r.domain}`, typed)
      }))
    })
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
  const productSearch = isDomainQuery || !wantsProducts(searchQuery, typed) ? Promise.resolve([]) : Promise.race([
    searchProducts(productText, tier, tier === "pro" ? 20 : 5, shopperCountry),
    new Promise<any[]>(r => setTimeout(() => r([]), 2500))
  ]).catch(() => [])
  // Rewritten searches (list_thirteen.sql): what this client searched just before, and what people
  // usually rewrite this search to (shown as related searches).
  noteReformulation(clientKey, typed)
  const rewritesTo = usualRewrites(typed)
  // "notion vs obsidian" → both sites; "does basecamp have a free plan" → the site and an answer.
  const comparing = isDomainQuery ? Promise.resolve(null) : comparison(typed).catch(() => null)
  const asking = isDomainQuery ? Promise.resolve(null) : questionSite(typed).catch(() => null)
  const nameTypos: string[] = []
  // Spelling runs alongside the search (the word list is small and fast): a misspelt search
  // ("accouting sofware") usually still finds a few loosely matching sites, so waiting until
  // nothing was found meant the correction was never offered.
  const spelling = !isDomainQuery && /[a-z]{5,}/i.test(searchQuery) ? suggestSpelling(searchQuery) : Promise.resolve(null)
  // homeCity: the searcher's last searched city, else where they are (Vercel's header).
  const searchOpts: any = { lite, places, related, didYouMean: nameTypos, homeCity }
  const [results, products, events] = await Promise.all([
    searchSites(searchQuery, tier, timing, notices, searchOpts).then(r => { sitesMs = Date.now() - t0; return r }),
    productSearch.then(r => { productsMs = Date.now() - t0; return r }),
    isDomainQuery ? Promise.resolve([]) : upcomingEvents(searchQuery)
  ])
  const compared = await comparing
  const asked = await asking
  const answer = asked ? await answerFromSite(asked.site, asked.keywords) : null
  // Pro: a short answer written from the top results, with sources, for question searches.
  const summary = tier === "pro" && QUESTION.test(typed) && results.length ? await answerSummary(typed, results, answer, tier).catch(() => null) : null
  const firstUp = [...(compared || []), ...(asked ? [asked.site] : [])]
    .map((x: any) => ({ ...x, pages: x.pages || {}, actions: x.actions || [], owner_key: undefined, matched: compared ? "compared site" : "the site the question is about" }))
  if (firstUp.length) {
    const first = new Set(firstUp.map(x => x.domain))
    let rest = results.filter((r: any) => !first.has(r.domain))
    // A question about one site: its own pages next ("basecamp.com/pricing"), then results that
    // mention it, then the rest (a page that only shares the words "free" and "plan" comes last).
    if (asked && !compared) {
      const d = asked.site.domain, word = d.split(".")[0].toLowerCase()
      const tier = (r: any) => r.domain.startsWith(`${d}/`) ? 0 : `${r.name} ${r.domain} ${r.matched || ""}`.toLowerCase().includes(word) ? 1 : 2
      rest = rest.map((r: any, i: number) => ({ r, i, t: tier(r) })).sort((a: any, b: any) => a.t - b.t || a.i - b.i).map((x: any) => x.r)
    }
    results.splice(0, results.length, ...firstUp, ...rest)
  }
  // Misspelt searches: suggest the closest well-known words (did_you_mean, list_eleven.sql), and
  // when nothing matched at all, search for the suggestion instead and say so.
  // When the results are thin (fewer than 5), the corrected search is run too, and its results are
  // shown instead when it finds more ("Showing results for …").
  let didYouMean: string | null = nameTypos[0] || await spelling
  let searchedFor: string | null = null
  if (!isDomainQuery && didYouMean && !nameTypos.length && results.length < 5) {
    const again = await searchSites(didYouMean, tier, timing, [], { lite })
    if (again.length > results.length) { results.splice(0, results.length, ...again); searchedFor = didYouMean }
  }
  res.setHeader("Server-Timing", [`sites;dur=${sitesMs}`, `products;dur=${productsMs}`, ...Object.entries(timing).map(([k, v]) => `${k};dur=${v}`)].join(", "))
  // Adult and gambling sites are left out unless the query asks for them.
  // Error pages, bot checks and parked domains aren't results; www. and bare domains count once.
  const seenHost = new Set<string>()
  const shown = withoutHidden(results as any[], searchQuery).filter((r: any) => {
    if (notAResult(r)) return false
    // A search for a word, not a domain: near-empty sites aren't worth showing.
    if (!isDomainQuery && !r.domain.includes("/") && nearlyEmpty(r)) return false
    // "localilabs.com/" (a row saved with a trailing slash) is the same site as localilabs.com.
    const host = String(r.domain).replace(/^www\./, "").replace(/\/+$/, "")
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
      ...(r.business ? { open_now: openNow(r.business.opening_hours, r.business.address?.country, new Date(), r.business.special_hours) } : {}),
      age_hours: r.updated_at ? Math.max(0, Math.round((now - Date.parse(r.updated_at)) / 3600_000)) : null,
      // Give this link to the user: it lets the site's owner see visits that came from AI agents.
      visit_url: trackedLink(`https://${r.domain}`, typed)
    })),
    ...(products.length ? { products: products.map((p: any) => ({ ...p, visit_url: trackedLink(p.url) })) } : {}),
    // Local searches with no indexed websites yet: places from OpenStreetMap (not indexed sites).
    ...(places.length ? { places: { source: "OpenStreetMap", attribution: "© OpenStreetMap contributors, ODbL", items: places } } : {}),
    ...(compared ? { comparison: { sites: compared.map((x: any) => x.domain), tip: "Both sites are the first two results. The actuent_compare tool (MCP) lines them up side by side." } } : {}),
    ...(summary ? { summary: { ...summary, note: "Written by AI from the sources listed; check them before relying on it." } } : {}),
    ...(answer ? { answer: { ...answer, note: "Sentences from the site's own pages that match the question; check the page before relying on them." } } : {}),
    ...(events.length ? { events } : {}),
    // A search for places without a city: places near the searcher came first.
    ...(searchOpts.nearCity ? { near: searchOpts.nearCity } : {}),
    ...(related.length || (await rewritesTo).length ? { related: [...new Set([...(await rewritesTo), ...related])].slice(0, 8) } : {}),
    ...(didYouMean ? { did_you_mean: didYouMean } : {}),
    ...(searchedFor ? { searched_for: searchedFor } : {}),
    // What happened, in plain English, whenever results are limited or empty (docs.actuent.ai/#errors).
    ...(unique.length ? { notices: unique, message: unique[0].message } : {})
  }
  // A busy-time answer isn't cached anywhere: a retry a minute later should get the full search.
  if (degraded) res.setHeader("Cache-Control", "no-store")
  else if (results.length > 0 || products.length > 0) {
    cacheSet(key, body)
    // Only full answers are shared for 30 minutes: a thin one may be a slow moment in the database.
    // …and never one from a slow moment (a search timed out, or "A vs B" couldn't find both sites).
    const thin = searchOpts.slow || (!compared && !isDomainQuery && !!comparisonSides(typed))
    if ((results.length >= 3 || isDomainQuery) && !thin) await later(sharedCacheSet(key, body))
  }
  res.setHeader("X-Search-Time", String(Date.now() - requestStart))
  return res.status(200).json(present(body, params))
}