import "../src/utils/db_guard"
import { translateKeywords } from "../src/utils/multilingual"
import { searchDishes } from "../src/utils/dishes"
import { shopFacts } from "../src/utils/shop_facts"
import { alternativeSearches } from "../src/utils/product_match"
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { withoutHidden, searchSites, quickSearch, isPlaceSearch, PLACE_KINDS } from "../src/utils/search"
import { queryCategories } from "../src/utils/rank_extras"
import { verifyApiKey, bearerKey, isInternalCall, rateLimit, rateLimitHeaders, keyHash, isBlocked, strike, BLOCKED_MESSAGE, hitCounter, ipHash } from "../src/utils/limits"
import { isExecutable } from "../src/utils/native"
import { searchProducts } from "../src/utils/products"
import { trackedLink } from "../src/utils/links"
import { fixSpelling } from "../src/utils/spelling"
import { categoryLeaders } from "../src/utils/leaders"
import { getSavedSite } from "../src/utils/crawler"
import { definitionTerm, wikipediaSummary, definitionResult, aboutTheTerm, isGeneric } from "../src/utils/define"
import { todayHours, openNow, opensNext } from "../src/utils/business"
import { notice, Notice, DEGRADED } from "../src/utils/notices"
import { later } from "../src/utils/later"
import { cleanQuery, cleanQueryKeepPrice, cacheKey, nearMe, wantsProducts } from "../src/utils/query"
import { cleanName, snippet, notAResult, nearlyEmpty } from "../src/utils/results"
import { WANTS_BEST, splitCity, cityCountry } from "../src/utils/local"
import { fallbackSearch } from "../src/utils/fallback"
import { dbReadOnly } from "../src/utils/db_guard"
import { comparison, comparisonSides, questionSite, answerFromSite } from "../src/utils/answer"
import { landmarkHours } from "../src/utils/landmark"
import { readPage } from "../src/utils/read_page"
import { entity } from "../src/utils/entity"
import { eventIcs, googleCalendarUrl } from "../src/utils/ics"
import { planPage } from "../src/utils/plan_page"
import { sendEmail } from "../src/utils/email"
import { sendBusinessMessage, answerMessage, optOut, messageStatus } from "../src/utils/messages"
import { answerSummary, QUESTION } from "../src/utils/summary"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

// The search log: searches that finish at the same moment on one server share one insert. No timer:
// waiting (it used to wait 5 s for more searches) kept every function alive longer, and Vercel
// bills memory for as long as a function is alive.
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
  return flushSearchLog()
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

// Searches for Actuent itself, and greetings or tests ("hi", "test") from people trying it out.
const SELF = /^(?:(?:what|who)(?:'s| is| are)\s+)?(?:actuent(?:\.ai)?|lawpy|lawp)(?:\s+(?:ai|search|mcp|mascot))?\s*\??$/i
const GREETING = /^(?:hi|hello|hey|hej|hola|yo|sup|ping|test|testing|test test|hello world|are you there|who are you)[!.?\s]*$/i
const TRY_THESE = ["what's open near me right now", "concerts in new york this weekend", "cheapest hoka clifton", "does notion have a free plan"]
const ABOUT_ACTUENT = { domain: "actuent.ai", sentences: [
  { text: "Actuent gives your AI the live internet: what's open now, what's on this weekend, real prices and what a company offers, each with a link to the source.", url: "https://actuent.ai" },
  { text: "Connect it to Claude, ChatGPT, Cursor or VS Code in 30 seconds, free with no account: docs.actuent.ai/connect. Lawpy is its mascot, a chaotic, cheeky explorer.", url: "https://docs.actuent.ai/connect" }
] }
const host = (d: string) => String(d || "").split("/")[0].replace(/^www\./, "")
async function selfSite(): Promise<any | null> {
  const saved: any = await getSavedSite("actuent.ai").catch(() => null)
  return saved ? { ...saved, owner_key: undefined, pages: saved.pages || {}, actions: saved.actions || [], matched: "Actuent itself", score: 100, visit_url: trackedLink("https://actuent.ai") } : null
}

// Questions about when an artist plays ("when is X playing", "X tour dates"), and the words to strip
// to get the artist's name.
const IS_ARTIST_ASK = /\b(when|where)\s+(is|are|does|do)\b.*\b(play|playing|perform|performing|on tour|touring)\b|\btour dates\b/i
const ARTIST_ASK = /\b(when|where|is|are|does|do|playing|performing|perform|play|touring|on tour|tour dates|tour|dates|concerts?|tickets|live|next|show|shows|in|the|this|weekend|tonight)\b/gi

const isDomainLike = (q: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(q.trim())

const OPEN_NOW = /\s*\b(?:(?:that|which|who)(?:'s|’s| is| are)?\s+|(?:is|are)\s+)?(?:(?:still|currently)\s+open|open\s+(?:right\s+)?now|open\s+at\s+the\s+moment)\b\??/i

function present(body: any, p: Params): any {
  let list: any[] = body.results || []
  if (p.category) list = list.filter(r => r.category === p.category)
  if (p.city) list = list.filter(r => String(r.business?.address?.city || "").toLowerCase() === p.city)
  // Nothing open right now (early morning, late night): say so and show what opens soonest instead of
  // an empty list, so assistants don't guess the data is missing.
  let nothingOpen: any = null
  if (p.openNow) {
    const open = list.filter(r => r.open_now === true)
    const soon = open.length ? [] : list.filter(r => r.business)
      .map(r => ({ ...r, opens_next: opensNext(r.business.opening_hours, r.business.address?.country, new Date(), Number(r.business.geo?.lon)) }))
      .filter(r => r.opens_next).sort((a, b) => a.opens_next.in_minutes - b.opens_next.in_minutes)
      .map(r => ({ ...r, opens_next: r.opens_next.at }))
    if (soon.length) {
      nothingOpen = { nothing_open_now: true, message: `None of these places are open right now. These open soonest (local time); the first opens at ${soon[0].opens_next}.` }
      list = soon
    } else if (!open.length && list.some(r => r.business && r.open_now == null)) {
      // No opening hours listed anywhere: show them anyway, and say so, rather than an empty answer.
      list = list.filter(r => r.business && r.open_now == null)
      nothingOpen = { hours_unknown: true, message: "These places don't list their opening hours, so Actuent can't confirm they're open right now. Check before going." }
    } else list = open
    // Places from OpenStreetMap: open ones first, closed ones left out.
    if (body.places?.items?.length) body = { ...body, places: { ...body.places, items: body.places.items.filter((x: any) => x.open_now !== false).sort((a: any, b: any) => (b.open_now === true ? 1 : 0) - (a.open_now === true ? 1 : 0)) } }
  }
  if (p.lang) list = [...list.filter(r => r.language === p.lang), ...list.filter(r => r.language !== p.lang)]
  if (p.sort === "popular") list = [...list].sort((a, b) => (a.popularity_rank || 1e9) - (b.popularity_rank || 1e9))
  // Best rated first (5-point ratings from the sites' own pages); unrated ones keep their order after.
  if (p.sort === "rating") list = [...list].sort((a, b) => (Number(b.business?.rating?.value) || 0) - (Number(a.business?.rating?.value) || 0))
  if (p.sort === "fresh") list = [...list].sort((a, b) => Date.parse(b.last_updated || 0) - Date.parse(a.last_updated || 0))
  const filtered = list.length !== (body.results || []).length || p.sort !== "relevance"
  const total = list.length
  if (p.offset || p.limit) list = list.slice(p.offset, p.limit != null ? p.offset + p.limit : undefined)
  return { ...body, results: list, count: list.length, ...(filtered || p.offset || p.limit ? { total } : {}), ...(nothingOpen || {}) }
}

// Event names saved straight from pages can still carry HTML entities ("&#8211;").
function decodeEntities(v: string): string {
  return String(v).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
}

// Upcoming events for event-style searches ("concerts copenhagen", "what's on in london").
const EVENTY = /\b(events?|concerts?|gigs?|what'?s on|festivals?|tonight|this weekend|shows?|exhibitions?|live music|comedy|playing|performing|on tour|tour dates|touring|markets?|flea markets?|loppemarked|kræmmermarked|things to do|what to do)\b/i
// Event lookups that timed out or failed (this instance): their answers aren't cached, so a slow moment
// doesn't hide events for the next 30 minutes.
const eventsFailed = new Set<string>()
// "checked today" … "checked 3 weeks ago: may have changed, read it live with actuent_get_page".
function freshness(hours: number | null): string {
  if (hours == null) return "unknown"
  if (hours < 24) return "checked today"
  if (hours < 24 * 7) return `checked ${Math.round(hours / 24)} day${Math.round(hours / 24) === 1 ? "" : "s"} ago`
  return `checked ${Math.round(hours / 24 / 7)} week${Math.round(hours / 24 / 7) === 1 ? "" : "s"} ago: may have changed; for prices, hours or availability read the page live (actuent_get_page)`
}

// The music venue readers' listings (actuent-crawler venue_readers.ts): every one is a concert.
const MUSIC_DOMAINS = ["vega.dk", "royalarena.dk", "drkoncerthuset.dk", "ab-b.dk", "pumpehuset.dk", "aegpresents.com", "mercuryeastpresents.com", "irvingplaza.com", "livenation.com", "thebellhouseny.com"]

// What kind of event, for filters ("comedy", "kids"): concerts have a genre instead.
function eventKind(text: string): string | null {
  if (/Genre: /.test(text)) return "concert"
  for (const [kind, re] of [["comedy", /\b(comedy|stand-?up|improv)\b/i], ["kids", /\b(kids|family|storytime|børn|barn)\b/i], ["market", /\b(market|marked|loppe|flea)\b/i],
    ["theatre", /\b(theatre|theater|teater)\b/i], ["talk", /\b(talk|lecture|foredrag|samtal)\b/i], ["exhibition", /\b(exhibition|udstilling|utställning)\b/i], ["concert", /\b(concert|koncert|konsert|live music)\b/i]] as [string, RegExp][])
    if (re.test(text)) return kind
  return null
}

async function upcomingEvents(q: string): Promise<any[]> {
  if (!EVENTY.test(q)) return []
  // "concerts in new york this weekend": the time words set the dates, not part of the city.
  const weekend = /\b(this weekend)\b/i.test(q), soon = /\b(tonight|today)\b/i.test(q)
  const place = splitCity(q.replace(/\b(this weekend|next weekend|this week|next week|tonight|today|tomorrow)\b/gi, " ").replace(/\s+/g, " ").trim())
  // Only the generic words go ("events", "what's on"); kinds of event stay ("comedy", "festival", "jazz").
  const topic = (place?.what || q).replace(/\b(events?|concerts?|koncerter|koncert|gigs?|what'?s on|shows?|live music|playing|performing|on tour|tour dates|touring)\b/gi, " ").replace(/\b(what'?s|whats|what|when|where|is|are|does|do|any|good|best|in|on|at|this|next|week|weekend|tonight|today|tomorrow|happening|going|playing|performing|perform|play|tour|touring|dates?|live|see|next)\b/gi, " ").replace(/['’?!]/g, " ").replace(/\s+/g, " ").trim()
  const now = new Date()
  const until = weekend ? new Date(now.getTime() + ((7 - now.getUTCDay()) % 7 + 1) * 86400000) : soon ? new Date(now.getTime() + 18 * 3600000) : null
  // "today": a market that opened at 9 is on all day, so events that started up to 8 hours ago count.
  const since = /\b(today|now|right now)\b/i.test(q) ? new Date(now.getTime() - 8 * 3600000) : now
  // Always a window (3 weeks unless the search says otherwise): scanning every future event was slow.
  const end = until || new Date(now.getTime() + 21 * 86400000)
  const filters = [`start_date=gte.${encodeURIComponent(since.toISOString())}`, `start_date=lte.${encodeURIComponent(end.toISOString())}`]
  // New York includes Brooklyn and Queens venues (and the like for LA and SF).
  const METRO: Record<string, string[]> = { "new york": ["new york", "brooklyn", "manhattan", "queens", "bronx", "forest hills"], "los angeles": ["los angeles", "hollywood", "anaheim", "inglewood"], "san francisco": ["san francisco", "oakland", "berkeley"] }
  if (place) {
    const names = METRO[place.city.toLowerCase()] || [place.city]
    filters.push(`or=${encodeURIComponent(`(${names.map(n => n.replace(/[*,()]/g, "")).flatMap(n => [`city.ilike.*${n}*`, `venue.ilike.*${n}*`]).join(",")})`)}`)
  }
  // Markets: Danish listings say "loppemarked" / "kræmmermarked", so "market" looks for those too.
  const MARKET = /\b(flea )?markets?\b|\bloppe ?marked\b|\bkræmmermarked\b/i
  const words = MARKET.test(topic) ? ["marked", "market", "loppe", "flea"] : topic && topic.length >= 3 && !/^(things to do|what to do|to do)$/i.test(topic) ? [topic.replace(/[*,()]/g, "")] : []
  // Market words are always in the event's name ("Loppemarked – Brønshøj Torv"): name only, which is fast.
  const fields = MARKET.test(topic) ? ["name"] : ["name", "description"]
  if (words.length) filters.push(`or=${encodeURIComponent(`(${words.flatMap(w => fields.map(f => `${f}.ilike.*${w}*`)).join(",")})`)}`)
  // "concerts in copenhagen" with no other topic: music only (a genre, a concert word, or a music
  // venue's listing), not every library talk and storytime in the city.
  else if (/\b(concerts?|koncert(er)?|gigs?|live music)\b/i.test(q)) filters.push(`or=${encodeURIComponent(`(description.ilike.*Genre:*,name.ilike.*concert*,name.ilike.*koncert*,description.ilike.*concert*,description.ilike.*koncert*,description.ilike.*live music*,domain.in.(${MUSIC_DOMAINS.join(",")}))`)}`)
  if (!place && !(topic && topic.length >= 3)) return []
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_events?select=name,url,domain,start_date,end_date,venue,city,price,currency,description&${filters.join("&")}&order=start_date.asc&limit=16`, {
      headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }, signal: AbortSignal.timeout(4000)
    })
    if (!r.ok) { eventsFailed.add(q); return [] }
    const rows: any[] = await r.json()
    // Adult events (fetish, kink, rope bondage, swingers) only when the search asks for them.
    const ADULT = /\b(kinbaku|shibari|bdsm|fetish|kink[sy]?|swingers?|erotic|erotik|strip ?club|sex ?party|tantra massage)\b/i
    return rows.filter(e => !/\b(betting|odds|prediction|casino|bookmaker|prognoz)\b|прогноз|ставк/i.test(`${e.name} ${e.url}`) && (ADULT.test(q) || !ADULT.test(`${e.name} ${e.venue || ""} ${e.url}`))).slice(0, 12)
      .map(({ description, ...e }) => {
        // Concerts carry "Genre: indie rock, post-punk (rock, indie)." (actuent-crawler genres.ts).
        const genre = String(description || "").match(/Genre: ([^.]+)\./)?.[1]
        const kind = eventKind(`${e.name} ${description || ""}`)
        return { ...e, name: decodeEntities(e.name), venue: e.venue ? decodeEntities(e.venue) : e.venue, ...(genre ? { genre } : {}), ...(kind ? { kind } : {}), source: `the listing on ${e.domain || "the venue's site"}`, visit_url: trackedLink(e.url) }
      })
  } catch { eventsFailed.add(q); return [] }
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
    // The database failed outright: answer from the built-in copy of the index if it has anything.
    const q = String(req.query?.q || req.body?.query || "").slice(0, 300)
    const fb = q ? await fallbackSearch(q, splitCity(q)?.city).catch(() => null) : null
    if (fb && (fb.results.length || fb.events.length)) {
      const n = notice("busy_fallback_index", { retryAfter: 60 })
      res.setHeader("Cache-Control", "no-store")
      return res.status(200).json({ query: q, count: fb.results.length, results: fb.results, ...(fb.events.length ? { events: fb.events } : {}), from_fallback_index: fb.built_at, notices: [n], message: n.message })
    }
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
  // Our own checks (nightly benchmark, post-deploy smoke test, load tests) are logged as "test", so
  // they don't count as real searches (search trends, ops numbers).
  const logTier = req.query?.bench === "1" || /^Actuent-(Benchmark|Smoke|LoadTest|Alerts|Warm)\//.test(String(req.headers["user-agent"] || "")) ? "test" : tier
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
    // Abuse that rotates IP addresses: a free-tier allowance per /24 network (5× one IP's), and one
    // shared allowance for scripts that don't say who they are (python-requests, curl, Go…).
    // Browsers, AI assistants (via the MCP server) and Actuent's SDKs aren't affected. No blocks, just 429.
    if (tier === "free") {
      const ua = String(req.headers["user-agent"] || "")
      const net = /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip.split(".").slice(0, 3).join(".") : null
      const script = !/actuent/i.test(ua) && (ua === "" ? "none" : ua.match(/^(python-requests|python-urllib|python-httpx|aiohttp|curl|wget|go-http-client|okhttp|java|libwww-perl|ruby|php|scrapy|httpie)/i)?.[1].toLowerCase())
      const checks: [string, number][] = [...(net ? [[`search:net:${net}`, maxPerMinute * 5] as [string, number]] : []), ...(script ? [[`search:script:${script}`, 300] as [string, number]] : [])]
      for (const [key, max] of checks) {
        const shared = await rateLimit(key, max)
        if (shared.limited) {
          res.setHeader("Cache-Control", "no-store")
          return res.status(429).json({ error: "Rate limit exceeded", message: `Too many free searches from your network or tool right now. Please wait ${shared.reset} seconds, or use an API key (Actuent Pro at actuent.ai).`, retry_after_seconds: shared.reset })
        }
      }
    }
  }

  // Messages to businesses (src/utils/messages.ts): sending and status only from Actuent's MCP server;
  // the Accept/Decline and opt-out links are for the business, by secret token.
  if (req.query?.msg_reply || req.query?.msg_optout) {
    // Email security scanners open links by themselves: a plain visit only shows a button, and only
    // pressing it (a POST) accepts, declines or opts out.
    const page = (body: string) => `<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Actuent</title><body style="background:#0a0a0a;color:#f0f0f0;font-family:-apple-system,sans-serif;padding:40px;text-align:center"><img src="https://api.actuent.ai/assets/lawpy/lawpy-wave.gif" width="96" alt="">${body}</body>`
    res.setHeader("Content-Type", "text/html; charset=utf-8")
    res.setHeader("Cache-Control", "no-store")
    if (req.method !== "POST") {
      const what = req.query.msg_optout ? `Stop messages through Actuent for ${String(req.query.msg_optout).replace(/[^a-z0-9.-]/gi, "")}?` : req.query.answer === "accept" ? "Accept this booking request?" : "Decline this booking request?"
      const label = req.query.msg_optout ? "Yes, stop them" : req.query.answer === "accept" ? "Accept" : "Decline"
      const qs = new URLSearchParams(Object.entries(req.query).filter(([k]) => ["msg_reply", "msg_optout", "answer", "t"].includes(k)).map(([k, v]) => [k, String(v)])).toString()
      return res.status(200).send(page(`<p style="font-size:18px">${what}</p><form method="post" action="/api/search?${qs.replace(/"/g, "")}"><button style="background:#ff8a3d;border:0;border-radius:8px;padding:12px 22px;font-size:16px;font-weight:600;cursor:pointer">${label}</button></form>`))
    }
    const text = req.query.msg_reply ? await answerMessage(String(req.query.msg_reply), String(req.query.answer || "")) : await optOut(String(req.query.msg_optout), String(req.query.t || ""))
    return res.status(200).send(page(`<p style="font-size:18px">${text.replace(/[<>&]/g, "")}</p>`))
  }
  // Receipt for an action Actuent's MCP server carried out (internal only): who, what, where, result.
  if (req.query?.op === "receipt") {
    if (!isInternalCall(req.headers["x-actuent-internal"])) return res.status(403).json({ error: "Only through Actuent's MCP server" })
    const b = req.body || {}
    const e = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(b.to || ""))) return res.status(400).json({ error: "Bad address" })
    const ok = await sendEmail(String(b.to), `Done: ${String(b.action || "action").slice(0, 60)} on ${String(b.domain || "").slice(0, 60)}`,
      `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px"><p>Your AI assistant did this for you through Actuent:</p><p><strong>${e(b.action)}</strong> on <strong>${e(b.domain)}</strong></p>${b.summary ? `<p style="white-space:pre-wrap;color:#444">${e(String(b.summary).slice(0, 1200))}</p>` : ""}<p style="color:#777;font-size:12px">${b.undo ? e(b.undo) : "If this wasn't what you wanted, contact the site directly."} Questions: support@localilabs.com</p></div>`)
    return res.status(ok ? 200 : 503).json({ sent: ok })
  }
  if (req.query?.op === "message" || req.query?.op === "message_status") {
    if (!isInternalCall(req.headers["x-actuent-internal"])) return res.status(403).json({ error: "Only through Actuent's MCP server" })
    const sender = String(req.headers["x-actuent-sender"] || "")
    if (req.query.op === "message_status") return res.status(200).json(await messageStatus(String(req.query.token || "")))
    if (!/^[0-9a-f]{64}$/.test(sender)) return res.status(400).json({ error: "Missing sender" })
    const r = await sendBusinessMessage(req.body || {}, sender)
    return res.status(r.status).json(r.body)
  }

  // ?plan=…&sig=…: a shared plan (signed by Actuent's MCP server).
  if (req.query?.plan) {
    const html = planPage(String(req.query.plan), String(req.query.sig || ""))
    res.setHeader("Content-Type", "text/html; charset=utf-8")
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400")
    return res.status(html ? 200 : 404).send(html || "<!DOCTYPE html><p>This plan link isn't valid.</p>")
  }

  // ?ics=<event url>: the event as a calendar file ("add to calendar").
  if (req.query?.ics) {
    if (req.query.to === "google") {
      const g = await googleCalendarUrl(String(req.query.ics)).catch(() => null)
      if (!g) return res.status(404).json({ error: "Actuent doesn't know that event" })
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600")
      return res.redirect(302, g)
    }
    const ics = await eventIcs(String(req.query.ics)).catch(() => null)
    if (!ics) return res.status(404).json({ error: "Actuent doesn't know that event" })
    res.setHeader("Content-Type", "text/calendar; charset=utf-8")
    res.setHeader("Content-Disposition", 'attachment; filename="event.ics"')
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600")
    return res.status(200).send(ics)
  }

  // ?entity=<name>: one thing (band, company, brand, place) with everything Actuent knows about it.
  if (req.query?.entity || req.body?.entity) {
    const found = await entity(String(req.query?.entity || req.body?.entity)).catch(() => null)
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600")
    return res.status(found ? 200 : 404).json(found || { error: "Nothing found by that name" })
  }

  // ?read=<url>: one page read live and returned as structured data (src/utils/read_page.ts).
  if (req.query?.read || req.body?.read) {
    const page = await readPage(String(req.query?.read || req.body?.read))
    res.setHeader("Cache-Control", "private, no-store")
    return res.status(page.status).json(page.body)
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
  // "cafés in Copenhagen that are open now" → search "cafés in Copenhagen", only open places.
  const wantsOpen = OPEN_NOW.test(typed)
  const words = wantsOpen ? typed.replace(new RegExp(OPEN_NOW.source, "gi"), " ").replace(/\s+/g, " ").trim() || typed : typed
  // "cofee in seatle" → "coffee in seattle": near-miss typos in cities and everyday words (src/utils/spelling.ts).
  const respelled = isDomainLike(words) ? null : fixSpelling(words)
  // Calls from Actuent's own MCP server come from Vercel's Dublin servers for every MCP user: their IP
  // and IP city say nothing about the person, so no "near me" city or remembered city from them.
  const internal = isInternalCall(req.headers["x-actuent-internal"])
  // …but the assistant can say where the user is (near=Copenhagen, or the user's area), for "near me".
  const nearParam = String(req.query?.near || req.body?.near || "").replace(/[^\p{L}\p{N} ,.'-]/gu, "").trim().slice(0, 60)
  const ipCity = nearParam ? nearParam.split(",")[0].trim() : internal ? undefined : req.headers["x-vercel-ip-city"] as string | undefined
  const params = readParams(req)
  if (wantsOpen) params.openNow = true
  // A city given as a filter (city=Copenhagen, as assistants send it) is searched in, not only used
  // to filter: "vegan restaurant" + Copenhagen searches "vegan restaurant in copenhagen".
  let asTyped = respelled || words
  if (params.city && !isDomainLike(words) && !asTyped.toLowerCase().includes(params.city)) {
    asTyped = `${asTyped} in ${params.city}`
    params.city = undefined
  }
  const localized = nearMe(asTyped, ipCity)
  const searchQuery = cleanQuery(localized)

  res.setHeader("X-Actuent-Tier", tier)
  // Signed-out GET searches can also be cached by Vercel's CDN for 15 minutes (a new deploy clears
  // it); anything with a key is private,
  // and so is "near me" (the answer depends on where the searcher is).
  // So is a search for places without a city ("cafés"): it favours the searcher's own city.
  const clientKey = ipHash((req.headers["x-forwarded-for"] as string || "unknown").split(",")[0].trim())
  const searchedCity = splitCity(searchQuery)?.city
  if (searchedCity && !internal) rememberCity(clientKey, searchedCity)
  const placeSearch = isPlaceSearch(searchQuery)
  const homeCity = placeSearch ? (nearParam ? headerCity(ipCity) : !internal ? recentCity(clientKey) || headerCity(ipCity) : null) : null
  res.setHeader("Vary", "Authorization")
  res.setHeader("Cache-Control", req.method === "GET" && !apiKey && localized === typed && !placeSearch
    ? "public, max-age=0, s-maxage=900, stale-while-revalidate=3600"
    : "private, no-store")

  // The price is part of the key: "shoes under 500 dkk" and "shoes" are different searches.
  // The deploy is part of it too, so a fix shows up straight away instead of after the cache expires.
  const key = `${tier}${req.query?.lawpy === "1" ? "+lawpy" : ""}:${(process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7)}:${cacheKey(cleanQueryKeepPrice(localized))}${homeCity ? `@${homeCity.toLowerCase()}` : ""}${WANTS_BEST.test(typed) ? "+best" : ""}`
  // This instance's memory first, then the shared cache every instance writes (list_thirteen.sql).
  // (A memory hit isn't stored again: that would keep an old answer alive for as long as people ask.)
  const inMemory = cacheGet(key)
  const cached = inMemory ?? await sharedCacheGet(key)
  if (cached) {
    if (!inMemory) cacheSet(key, cached)
    await later(trackSearch(typed, (cached as any).results.map((r: any) => r.domain), logTier, tier === "pro" && !isInternalCall(req.headers["x-actuent-internal"]) ? apiKey : null, Date.now() - requestStart, (cached as any).results.length))
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
        ...(r.business ? { open_now: openNow(r.business.opening_hours, r.business.address?.country, new Date(), r.business.special_hours, Number(r.business.geo?.lon)) } : {}),
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
  const shopperCountry = cityCountry(productPlace?.city) || (internal ? "" : String(req.headers["x-vercel-ip-country"] || "")).toLowerCase().slice(0, 2) || null
  // Looking for a place ("coffee in seattle", "anything open now"), not shopping: no products.
  const lookingForPlace = wantsOpen || (() => { const p = splitCity(searchQuery); return !!p && [...queryCategories(p.what)].some(c => PLACE_KINDS.has(c)) && !/\b(buy|beans?|shoes?|clothes|order online|delivery)\b/i.test(p.what) })()
  // Software and services ("best crm", "vpn") aren't shopping either.
  // …and neither are events ("comedy in los angeles", "concerts this weekend").
  const productSearch = isDomainQuery || lookingForPlace || EVENTY.test(typed) || !!categoryLeaders(searchQuery) || !wantsProducts(searchQuery, typed) ? Promise.resolve([]) : Promise.race([
    searchProducts(productText, tier, tier === "pro" ? 20 : 5, shopperCountry),
    new Promise<any[]>(r => setTimeout(() => r([]), 2500))
  ]).catch(() => [])
  // Rewritten searches (list_thirteen.sql): what this client searched just before, and what people
  // usually rewrite this search to (shown as related searches).
  noteReformulation(clientKey, typed)
  const rewritesTo = usualRewrites(typed)
  // "notion vs obsidian" → both sites; "does basecamp have a free plan" → the site and an answer.
  const comparing = isDomainQuery ? Promise.resolve(null) : comparison(typed).catch(() => null)
  // "pegasus 41 vs clifton 9": the best-matching product for each side, side by side (when both are products).
  const vsParts = typed.split(/\s+(?:vs\.?|versus|or|eller|oder|ou|o)\s+/i).map(x => x.trim()).filter(Boolean)
  const comparingProducts = !isDomainQuery && vsParts.length === 2 && /\s(vs\.?|versus)\s/i.test(typed)
    ? Promise.race([
        Promise.all(vsParts.map(side => searchProducts(side, tier, 1, shopperCountry).then(r => r[0] || null).catch(() => null))),
        new Promise<null[]>(r => setTimeout(() => r([null, null]), 3000))
      ])
    : Promise.resolve([null, null])
  const asking = isDomainQuery ? Promise.resolve(null) : questionSite(typed).catch(() => null)
  // "Is the Louvre open on Monday?": the place's hours from OpenStreetMap (not for "cafés open now").
  const placeHoursP = isDomainQuery || placeSearch ? Promise.resolve(null) : landmarkHours(typed).catch(() => null)
  // "What is a cat?": Wikipedia's summary, looked up alongside the search.
  const term = isDomainQuery ? null : definitionTerm(words)
  const defining = term ? wikipediaSummary(term).catch(() => null) : Promise.resolve(null)
  const nameTypos: string[] = []
  // Spelling runs alongside the search (the word list is small and fast): a misspelt search
  // ("accouting sofware") usually still finds a few loosely matching sites, so waiting until
  // nothing was found meant the correction was never offered.
  const spelling = !isDomainQuery && /[a-z]{5,}/i.test(searchQuery) ? suggestSpelling(searchQuery) : Promise.resolve(null)
  // homeCity: the searcher's last searched city, else where they are (Vercel's header).
  const searchOpts: any = { lite, places, related, didYouMean: nameTypos, homeCity, best: WANTS_BEST.test(typed) }
  const [results, products, events, dishes] = await Promise.all([
    searchSites(searchQuery, tier, timing, notices, searchOpts).then(r => { sitesMs = Date.now() - t0; return r }),
    productSearch.then(r => { productsMs = Date.now() - t0; return r }),
    isDomainQuery ? Promise.resolve([]) : upcomingEvents(searchQuery),
    // Dishes and services with prices from local businesses' own menus.
    isDomainQuery ? Promise.resolve([]) : searchDishes(cleanQueryKeepPrice(localized)).catch(() => [])
  ])
  const compared = await comparing
  // Shops compared ("zalando vs boozt"): products, price range, shipping and returns, side by side.
  const facts = compared ? await Promise.race([Promise.all(compared.map((x: any) => shopFacts(x).catch(() => null))), new Promise<null[]>(r => setTimeout(() => r([null, null]), 2500))]) : [null, null]
  const pair = await comparingProducts
  const productPair = pair[0] && pair[1] && pair[0].url !== pair[1].url ? pair.map((p: any) => ({
    name: p.name, price: p.price, currency: p.currency, price_eur: p.price_eur, domain: p.domain, url: p.url, image: p.image,
    ...(p.lowest_90_days != null ? { lowest_90_days: p.lowest_90_days } : {}), ...(p.price_change_percent ? { price_change_percent: p.price_change_percent } : {}),
    shops: 1 + (p.other_shops?.length || 0)
  })) : null
  let asked: any = await asking
  // "What is a cat": the thing, not a site that happens to match "cat" (only a site named exactly that wins).
  if (asked && term && (isGeneric(words) || asked.site.domain.replace(/^www\./, "").split(".")[0].toLowerCase() !== term.toLowerCase().replace(/\s+/g, ""))) asked = null
  // Actuent itself ("actuent", "lawpy", "what is actuent"): actuent.ai first, with a plain answer.
  // A greeting or a test ("hi", "test"): Lawpy says hello and suggests what to try.
  const self = SELF.test(typed.trim()) ? await selfSite() : null
  if (self) results.splice(0, results.length, self, ...results.filter((r: any) => host(r.domain) !== "actuent.ai").filter((r: any) => !/lawpay/i.test(r.domain)))
  const greeting = GREETING.test(typed.trim())
  if (greeting) results.splice(0, results.length)
  // A definition question that isn't about a site: Wikipedia first, then only results about the word.
  const wiki = asked ? null : await defining
  const definition = wiki ? definitionResult(wiki, typed) : null
  if (definition) results.splice(0, results.length, definition.result as any, ...aboutTheTerm(results, term!).filter((r: any) => r.domain !== "en.wikipedia.org"))
  const answer = self || greeting ? ABOUT_ACTUENT : asked ? await answerFromSite(asked.site, asked.keywords, typed) : definition ? definition.answer : null
  // Pro: a short answer written from the top results, with sources, for question searches.
  // Pro gets a short answer written from the sources; so does the humans page ("Ask Lawpy",
  // lawpy=1), within tight limits so launch traffic can't use up the free AI quota.
  const lawpyAsked = req.query?.lawpy === "1" && tier !== "pro" && QUESTION.test(typed) && results.length > 0
  const lawpyAllowed = lawpyAsked && !(await rateLimit(`lawpy:ip:${clientKey}`, 5)).limited && !(await rateLimit("lawpy:all", 30)).limited
  const summary = (tier === "pro" || lawpyAllowed) && QUESTION.test(typed) && results.length ? await answerSummary(typed, results, answer, tier).catch(() => null) : null
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
  let searchedFor: string | null = respelled
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
  // "When is Ray LaMontagne playing": the events answer it. Sites stay only when they're about the
  // artist (setlist.fm, the venue), not ray.io for "ray".
  // "comedy in new york": with events found, sites stay only when they're about that city (a club, a
  // listings site for it), not comedy.co.uk.
  const eventCity = EVENTY.test(typed) ? splitCity((respelled || typed).replace(/\b(this weekend|next weekend|this week|tonight|today|tomorrow)\b/gi, " ").replace(/\s+/g, " ").trim()) : null
  if (eventCity) {
    const c = eventCity.city.toLowerCase(), names = c === "new york" ? ["new york", "nyc", "brooklyn", "manhattan", "queens"] : c === "los angeles" ? ["los angeles", "hollywood", " la "] : [c]
    const local = (r: any) => { const t = ` ${r.name || ""} ${r.domain || ""} ${r.snippet || ""} ${JSON.stringify(r.business?.address || {})} ${JSON.stringify(r.pages || {})} `.toLowerCase(); return names.some(n => t.includes(n)) }
    // …and that are places or things to do, not software companies based there (Linkfire for "markets").
    results.splice(0, results.length, ...results.filter((r: any) => local(r) && !/^(software|developer|ai|finance|jobs|news_media)$/.test(String(r.category || ""))))
  }
  if (events.length && IS_ARTIST_ASK.test(typed)) {
    const who = typed.toLowerCase().replace(ARTIST_ASK, " ").replace(/[?!.,'’]/g, " ").split(/\s+/).filter(w => w.length >= 3)
    if (who.length) {
      const about = (r: any) => { const t = `${r.name || ""} ${r.snippet || ""} ${JSON.stringify(r.pages || {})}`.toLowerCase(); return who.every(w => t.includes(w)) }
      results.splice(0, results.length, ...results.filter(about))
    }
  }
  // "Cafes in Brooklyn": only places of that kind (businesses, or sites of that category), never a
  // site that only shares the letters ("McAfee", "decaf…"). OpenStreetMap places fill in below.
  const placeAsk = isDomainQuery ? null : splitCity(searchQuery)
  const kinds = placeAsk ? [...queryCategories(placeAsk.what)].filter(c => PLACE_KINDS.has(c)) : []
  // …and in that city: a business there, or a site of that kind that mentions the city (not Starbucks' head office site).
  const inCity = (r: any) => {
    const c = placeAsk!.city.toLowerCase(), metro = c === "new york" ? ["new york", "brooklyn", "manhattan", "queens", "bronx"] : [c]
    const where = `${r.business?.address?.city || ""} ${r.business?.address?.region || ""} ${JSON.stringify(r.business?.address || {})}`.toLowerCase()
    return metro.some(m => where.includes(m)) || (!r.business && kinds.includes(r.category) && metro.some(m => `${r.snippet || ""} ${JSON.stringify(r.pages || {})}`.toLowerCase().includes(m)))
  }
  // …and of that kind: a software company with an Austin office isn't a taco place.
  const ofKind = (r: any) => kinds.includes(r.category) || (!r.category && !/^(organization|corporation|ngo|governmentorganization|educationalorganization)$/i.test(String(r.business?.type || "")))
  if (kinds.length && !asked && !compared) results.splice(0, results.length, ...results.filter((r: any) => inCity(r) && ofKind(r)))
  const domains = results.map(r => r.domain)

  // MCP calls are already logged per key by actuent-private, so don't attribute them to the key twice.
  const trackKey = tier === "pro" && !isInternalCall(req.headers["x-actuent-internal"]) ? apiKey : null
  await later(trackSearch(typed, domains, logTier, trackKey, Date.now() - requestStart, results.length))

  if (searchedFor) notices.splice(0, notices.length, ...notices.filter(n => n.code !== "no_results" && n.code !== "busy_no_results"))
  // The database couldn't answer (busy, down or full): the built-in copy of the index instead.
  if (!results.length && !products.length && !places.length && !events.length && !isDomainQuery && (dbReadOnly() || notices.some(n => n.code.startsWith("busy")))) {
    const fb = await fallbackSearch(typed, searchedCity).catch(() => null)
    if (fb?.results.length) results.push(...fb.results)
    if (fb?.events.length) events.push(...fb.events)
    if (fb && (fb.results.length || fb.events.length)) notices.push(notice("busy_fallback_index", { retryAfter: 60 }))
  }
  // Never a dead end: nothing in the index, no products, places or events → Wikipedia on the search
  // itself ("photosynthesis", "roman empire"), before falling back to "try instead".
  let lastResort: any = null
  if (!results.length && !products.length && !places.length && !events.length && !greeting && !isDomainQuery && words.split(/\s+/).length <= 5) {
    const w = await wikipediaSummary(cleanQuery(words) || words).catch(() => null)
    if (w) { lastResort = definitionResult(w, typed); results.push(lastResort.result) }
  }
  // Anything found (results, an answer, events) means no "came back empty-handed" or "nothing matched".
  if (events.length || results.length || products.length || places.length) notices.splice(0, notices.length, ...notices.filter(n => n.code !== "no_results" && n.code !== "busy_no_results"))
  if (!results.length && !products.length && !places.length && !events.length && !notices.length) notices.push(notice("no_results", { query: typed }))
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
      ...(r.business ? { open_now: openNow(r.business.opening_hours, r.business.address?.country, new Date(), r.business.special_hours, Number(r.business.geo?.lon)), ...(todayHours(r.business.opening_hours, r.business.address?.country, Number(r.business.geo?.lon)) || {}) } : {}),
      age_hours: r.updated_at ? Math.max(0, Math.round((now - Date.parse(r.updated_at)) / 3600_000)) : null,
      // In plain words, for assistants: how fresh this is, and what to do when it may be out of date.
      freshness: freshness(r.updated_at ? (now - Date.parse(r.updated_at)) / 3600_000 : null),
      // Where this came from, so the assistant (and the user) can judge it.
      source: r.native ? "the site's own LAWP file (published by the site)" : /wikipedia\.org$/.test(r.domain) ? "Wikipedia" : r.business?.source === "OpenStreetMap" ? "the site's own pages, with address and hours from OpenStreetMap" : "the site's own pages, read by Actuent",
      // Give this link to the user: it lets the site's owner see visits that came from AI agents.
      visit_url: trackedLink(`https://${r.domain}`, typed)
    })),
    ...(products.length ? { products: products.map((p: any) => ({ ...p, source: `${p.domain || "the shop"}'s own product page`, visit_url: trackedLink(p.url) })) } : {}),
    // Local searches with no indexed websites yet: places from OpenStreetMap (not indexed sites).
    ...(places.length ? { places: { source: "OpenStreetMap", attribution: "© OpenStreetMap contributors, ODbL", items: places } } : {}),
    ...(productPair ? { product_comparison: productPair } : {}),
    ...(compared ? { comparison: { sites: compared.map((x: any) => x.domain), ...(facts[0] || facts[1] ? { shops: Object.fromEntries(compared.map((x: any, i: number) => [x.domain, facts[i]])) } : {}), tip: "Both sites are the first two results. The actuent_compare tool (MCP) lines them up side by side." } } : {}),
    ...(summary ? { summary: { ...summary, note: "Written by AI from the sources listed; check them before relying on it." } } : {}),
    ...(answer || lastResort ? { answer: { ...(answer || lastResort.answer), note: "Sentences from the site's own pages that match the question; check the page before relying on them." } } : {}),
    ...(events.length ? { events } : {}),
    ...(await placeHoursP ? { place_hours: await placeHoursP } : {}),
    ...(dishes.length ? { dishes } : {}),
    // A search for places without a city: places near the searcher came first.
    ...(searchOpts.nearCity ? { near: searchOpts.nearCity } : {}),
    ...(related.length || (await rewritesTo).length ? { related: [...new Set([...(await rewritesTo), ...related])].slice(0, 8) } : {}),
    ...(didYouMean ? { did_you_mean: didYouMean } : {}),
    ...(searchedFor ? { searched_for: searchedFor } : {}),
    // Nothing at all: other wordings to try (English words for foreign ones, the everyday word, fewer words).
    ...(greeting ? { message: "Hi! I'm Lawpy 👋 Actuent gives your AI the live internet. Ask about something happening right now.", try_instead: TRY_THESE } : {}),
    ...(!greeting && !results.length && !products.length && !places.length && !events.length && !isDomainQuery ? { try_instead: [...new Set([translateKeywords(typed).foreign ? translateKeywords(typed).query : "", ...alternativeSearches(typed)].filter(x => x && x.toLowerCase() !== typed.toLowerCase().trim()))].slice(0, 3) } : {}),
    // What happened, in plain English, whenever results are limited or empty (docs.actuent.ai/#errors).
    ...(unique.length ? { notices: unique, message: unique[0].message } : {})
  }
  // A busy-time answer isn't cached anywhere: a retry a minute later should get the full search.
  const eventsMissing = eventsFailed.delete(searchQuery)
  if (degraded || eventsMissing) res.setHeader("Cache-Control", "no-store")
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