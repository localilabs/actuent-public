import { translateKeywords, queryLanguage } from "./multilingual"
import { notice, Notice } from "./notices"
import { splitCity, localBusinesses, osmPlaces, localNeeds, needsFactor, cityCountry, inCountry, COUNTRY_INFO } from "./local"
import { queryCategories, mergeRegional, intentBoost, freshnessBoost, qualityFactor, pageAnswerFirst, diversify } from "./rank_extras"
import { later } from "./later"
import { nameOf, looksLikeName, brandSites, sameOwner, linkedProjects, officialWebsite } from "./brand"
import { sites, Site } from "../data/sites"
import { crawlSite, crawlPage, getSavedSite } from "./crawler"
import { complete, llmStatus, Tier } from "./llm"
import { isRateLimited } from "./limits"
import { safeParseJSON } from "./parseAI"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

const DOMAIN_AUTHORITY: Record<string, number> = {
  "google.com": 100, "youtube.com": 98, "facebook.com": 96,
  "amazon.com": 95, "wikipedia.org": 94, "twitter.com": 93,
  "instagram.com": 92, "linkedin.com": 91, "reddit.com": 90,
  "netflix.com": 89, "apple.com": 88, "microsoft.com": 87,
  "github.com": 86, "spotify.com": 85, "airbnb.com": 84,
  "uber.com": 83, "nike.com": 82, "adidas.com": 81,
  "stripe.com": 80, "shopify.com": 79, "notion.so": 78,
  "figma.com": 77, "vercel.com": 76, "openai.com": 75,
  "anthropic.com": 74, "producthunt.com": 73, "techcrunch.com": 72,
  "asics.com": 71, "newbalance.com": 70, "puma.com": 69,
  "asos.com": 68, "zara.com": 67, "hm.com": 66,
  "booking.com": 65, "tripadvisor.com": 64, "paypal.com": 63,
  "wise.com": 62, "revolut.com": 61, "monzo.com": 60
}

// Popularity: the site's Tranco rank (top 1M sites, set weekly by the popularity job) on a log
// scale — top 100 ≈ 100, top 1K ≈ 80, top 10K ≈ 60, top 100K ≈ 40, top 1M ≈ 20; unranked 10.
// The hand-picked table above is the fallback before ranks are loaded.
function getDomainAuthority(domain: string, rank?: number | null): number {
  if (rank && rank > 0) return Math.max(20, Math.min(100, Math.round(140 - 20 * Math.log10(rank))))
  const root = domain.replace(/^www\./, "").split("/")[0]
  return DOMAIN_AUTHORITY[root] || 10
}

// Adult and gambling sites stay out of results unless the search is clearly for them.
const HIDDEN = new Set(["adult", "gambling"])
const WANTS_HIDDEN = /\b(porn|xxx|sex|nsfw|adult|escort|casino|betting|gambling|poker|slots?)\b/i
// Actuent's own sites (docs, dashboards) only when the search is about Actuent: the docs use
// example searches like "barber amsterdam", which made them match.
const OWN = /(^|\.)(actuent\.ai|localilabs\.com)(\/|$)/i
export function withoutHidden<T extends { category?: string, domain?: string }>(results: T[], query: string): T[] {
  const own = /actuent|lawp|localilabs/i.test(query)
  return results.filter(r => (WANTS_HIDDEN.test(query) || !r.category || !HIDDEN.has(r.category)) && (own || !OWN.test(String(r.domain || ""))))
}

// Light stemming so "payments" matches "payment" and "restaurants" matches "restaurant"
// (substring matching then covers the rest: "book" matches "booking").
export function stem(word: string): string {
  const w = word.toLowerCase()
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y"
  if (w.length > 4 && w.endsWith("es") && /(ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1)
  return w
}
// Words that say little about what a site is ("online payments": "payments" is what matters).
const WEAK_WORDS = new Set(["online", "software", "app", "apps", "platform", "tool", "tools", "service", "services", "best", "top", "free", "cheap", "website", "site", "near", "me", "the", "and", "for", "with"])

function scoreMatch(site: Site, query: string): number {
  const words = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean).map(stem))]
  let keywordScore = 0

  for (const word of words) {
    if (site.name.toLowerCase().includes(word)) keywordScore += 3
    // Keyword-named domains ("projectmanager.com") shouldn't outrank the products people mean.
    if (site.domain.toLowerCase().includes(word)) keywordScore += 1
    for (const page of Object.values(site.pages)) {
      if (page.title.toLowerCase().includes(word)) keywordScore += 2
      if (page.content.toLowerCase().includes(word)) keywordScore += 1
    }
    for (const action of site.actions) {
      for (const intent of action.intent) {
        if (intent.includes(word)) keywordScore += 3
      }
      if (action.description.toLowerCase().includes(word)) keywordScore += 2
      if (action.name.toLowerCase().includes(word)) keywordScore += 2
    }
  }

  if (keywordScore === 0) return 0

  const pageCount = Object.keys(site.pages || {}).length
  const actionCount = (site.actions || []).length
  const avgIntent = actionCount > 0
    ? site.actions.reduce((s, a) => s + (a.intent?.length || 0), 0) / actionCount : 0
  let lawpBoost = 0
  if (pageCount >= 3) lawpBoost += 2
  if (actionCount >= 3) lawpBoost += 2
  if (avgIntent >= 5) lawpBoost += 1

  const authorityBoost = (getDomainAuthority(site.domain, (site as any).popularity_rank) / 100) * 12
  // Sites publishing their own LAWP rank higher, which gives sites a reason to adopt it.
  const nativeBoost = site.native ? 3 : 0

  return keywordScore + lawpBoost * 0.3 + authorityBoost + nativeBoost
}

// "Why this result": a short note of which words matched where, so an agent can tell the user
// why a site came up ("dentist" in name, actions (book); "berlin" in address; publishes its own LAWP).
const EXPLAIN_SKIP = new Set(["the", "and", "for", "with", "near", "best", "cheap", "online", "top", "buy"])
export function explainMatch(site: Site, query: string, related = "", original = ""): string | undefined {
  const where = (word: string): string[] => {
    const places: string[] = []
    if (site.name?.toLowerCase().includes(word)) places.push("name")
    if (site.domain?.toLowerCase().includes(word)) places.push("domain")
    const actions = (site.actions || []).filter(a => a.intent?.some(i => i.toLowerCase().includes(word)) || a.name?.toLowerCase().includes(word) || a.description?.toLowerCase().includes(word))
    if (actions.length) places.push(`actions (${actions.slice(0, 3).map(a => a.id).join(", ")})`)
    const pages = Object.entries(site.pages || {}).filter(([, p]) => p?.title?.toLowerCase().includes(word) || p?.content?.toLowerCase().includes(word))
    if (pages.length) places.push(pages.length === 1 && pages[0][0] !== "/" ? `page ${pages[0][0]}` : "page text")
    const addr = (site as any).business?.address
    if (addr && JSON.stringify(addr).toLowerCase().includes(word)) places.push("address")
    return places
  }
  const significant = (q: string) => [...new Set(q.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !EXPLAIN_SKIP.has(w)).map(stem))]
  const parts: string[] = []
  for (const word of significant(query)) { const w = where(word); if (w.length) parts.push(`"${word}" in ${w.join(", ")}`) }
  if (!parts.length) for (const word of significant(related).slice(0, 6)) { const w = where(word); if (w.length) { parts.push(`related term "${word}" in ${w.join(", ")}`); if (parts.length >= 2) break } }
  if (original && original.toLowerCase() !== query.toLowerCase()) parts.push(`query read as "${query}"`)
  if (site.native) parts.push("publishes its own LAWP")
  const rank = (site as any).popularity_rank
  if (rank && rank <= 10000) parts.push("widely used site")
  return parts.length ? parts.join("; ") : undefined
}

const SUPABASE_HEADERS = {
  "apikey": SUPABASE_SERVICE_KEY,
  "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json"
}

// Full-text search runs inside Postgres (search_lawp_sites / search_lawp_pages), so every
// indexed site is searchable. Falls back to scanning a 200-row sample if the functions are missing.
// null only when the search function is missing (old database): then a small sample is used.
// A slow or failing database gives [] and a notice, never a random sample posing as results.
async function rpc(fn: string, query: string, max: number, onFail?: () => void): Promise<any[] | null> {
  const failed = () => { onFail?.(); return [] }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: SUPABASE_HEADERS,
      body: JSON.stringify({ q: query, max_results: max }),
      // A slow database call must not hold up the whole search: answer with what we have (the
      // best-known sites come from topSites meanwhile, and the database finishes warming up anyway).
      signal: AbortSignal.timeout(4000)
    })
    if (r.status === 404) return null
    if (!r.ok) return failed()
    return await r.json()
  } catch { return failed() }
}

async function fetchSample(table: string, select: string): Promise<any[]> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${select}&limit=200`, { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(4000) })
    if (!r.ok) return []
    return await r.json()
  } catch { return [] }
}

// Candidate sites from Postgres full-text search (scored later in searchIndex).
// The 20,000 best-known sites that have every word, by a small index (list_thirteen.sql): a few
// hundred milliseconds even when the full search is slow the first time a search is run (the
// free database can't keep the whole index in memory). mailchimp.com for "email marketing" then
// always makes it, even if the full search times out.
async function topSites(query: string): Promise<any[]> {
  const words = query.replace(/[^\p{L}\p{N}\s]/gu, " ").trim()
  if (!words) return []
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=domain,name,pages,actions,native,updated_at,language,business,category,popularity_rank&status=is.null&popularity_rank=lte.20000&search_text=plfts(english).${encodeURIComponent(words)}&order=popularity_rank.asc&limit=40`, { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(2500) })
    const rows = r.ok ? await r.json() : []
    // Ranked like the full search would: every word matched (+1) and how well known the site is.
    return Array.isArray(rows) ? rows.map((row: any) => ({ ...row, rank: 1 + Math.max(0, 6 - Math.log10(Math.max(row.popularity_rank || 1, 1))) / 12 })) : []
  } catch { return [] }
}

async function searchSupabase(query: string, onFail?: () => void): Promise<Site[]> {
  const [full, top] = await Promise.all([rpc("search_lawp_sites", query, 50, onFail), topSites(query)])
  const found = full ?? await fetchSample("lawp_sites", "domain,name,pages,actions")
  const rows = [...found, ...top.filter(t => !found.some((f: any) => f.domain === t.domain))]
  return rows.map((row: any) => ({
    domain: row.domain, name: row.name, pages: row.pages || {}, actions: row.actions || [], native: !!row.native,
    updated_at: row.updated_at || undefined, language: row.language || undefined, business: row.business || undefined, category: row.category || undefined, popularity_rank: row.popularity_rank || undefined, rank: row.rank || undefined
  }))
}

// Sites in one country that match the words ("shoes" + Denmark → .dk and Danish-language sites).
// The main search favours well-known sites, so a country's own shops are fetched separately.
async function countrySites(what: string, country: string, lang: string | null): Promise<Site[]> {
  const words = what.replace(/[^\p{L}\p{N}\s]/gu, " ").trim()
  if (!words) return []
  const where = [`domain.like.*.${country === "gb" ? "uk" : country}`, ...(lang ? [`language.eq.${lang}`] : [])].join(",")
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=domain,name,pages,actions,native,updated_at,language,business,category,popularity_rank&status=is.null&search_text=plfts(english).${encodeURIComponent(words)}&or=(${encodeURIComponent(where)})&limit=30`, { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(2500) })
    const rows = r.ok ? await r.json() : []
    return Array.isArray(rows) ? rows.map((row: any) => ({ ...row, pages: row.pages || {}, actions: row.actions || [] })) : []
  } catch { return [] }
}

// Country endings used by sites everywhere (.io, .ai, .co…): they don't say where a site is.
const GENERIC_CCTLDS = new Set(["io", "ai", "co", "me", "tv", "fm", "ly", "gg", "to", "so", "sh", "ac", "cc", "ws", "is", "am", "la", "gl", "vc", "sc", "xyz", "eu"])

async function searchPages(query: string, onFail?: () => void): Promise<Site[]> {
  const rows = await rpc("search_lawp_pages", query, 50, onFail)
    ?? await fetchSample("lawp_pages", "domain,path,title,content,actions")
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return rows
    .map((row: any) => {
      let score = 0
      for (const word of words) {
        if (row.title?.toLowerCase().includes(word)) score += 3
        if (row.content?.toLowerCase().includes(word)) score += 1
        if (row.domain?.toLowerCase().includes(word)) score += 2
        if (row.path?.toLowerCase().includes(word)) score += 2
        if (Array.isArray(row.actions)) {
          for (const action of row.actions) {
            for (const intent of (action.intent || [])) {
              if (intent.includes(word)) score += 3
            }
          }
        }
      }
      if (score === 0) return null
      const authorityBoost = (getDomainAuthority(row.domain, row.popularity_rank) / 100) * 8
      return { row, score: score + authorityBoost }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 5)
    .map(({ row }: any) => ({
      // A homepage is the site itself ("localilabs.com", not a second "localilabs.com/" result).
      domain: row.path === "/" || !row.path ? row.domain : `${row.domain}${row.path}`,
      name: row.title,
      pages: { [row.path]: { title: row.title, content: row.content } },
      actions: row.actions || []
    }))
}

function parseFullUrl(query: string): { domain: string, path: string } | null {
  const match = query.match(
    /(?:https?:\/\/)?([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,})(\/[^\s]*)?/i
  )
  if (!match) return null
  return { domain: match[1].toLowerCase(), path: match[2] || "/" }
}

const PLACEHOLDER_DOMAINS = new Set(["example.com", "example.org", "example.net"])

// Last resort when the index has nothing: ask Groq for up to 3 real sites and crawl them in parallel.
// null when the guess couldn't be made (busy), [] when there's genuinely nothing to add.
async function suggestAndCrawl(query: string, seen: Set<string>, tier: Tier): Promise<Site[] | null> {
  const answer = await complete(
    `A user searched: "${query}". List up to 3 real, existing websites most relevant to this search. If the search is gibberish or no real website fits, reply with NONE. Reply with bare domains only, comma separated, no http, no explanation. Example: nike.com,adidas.com,asos.com`,
    10000,
    tier
  )
  if (!answer) {
    console.error(`suggestAndCrawl: no model could answer for "${query}"`)
    return null
  }
  const found = answer.toLowerCase().match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/g) || []
  const domains = [...new Set(found)]
    .filter(d => !seen.has(d) && !PLACEHOLDER_DOMAINS.has(d))
    .slice(0, 3)

  const crawled = await Promise.all(domains.map(async domain => {
    try {
      return await getSavedSite(domain) ?? await crawlSite(domain, tier)
    } catch (e) {
      console.error(`suggestAndCrawl: crawl failed for ${domain}:`, e)
      return null
    }
  }))

  const results: Site[] = []
  for (const site of crawled) {
    if (site && !seen.has(site.domain)) {
      sites[site.domain] = site
      seen.add(site.domain)
      results.push(site)
    }
  }
  return results
}

// Semantic search: an LLM expands keyword queries with synonyms and related terms ("trainers" →
// sneakers, running shoes, footwear), so sites match on meaning, not only exact words. Works on
// the whole index with no embeddings to backfill. Cached per instance.
const expansionCache = new Map<string, { english: string, terms: string[], expires: number }>()

// Also handles any language: the query is translated to English (the index is English), so a
// German search finds English LAWP and results always come back in English.
const SB_URL = process.env.SUPABASE_URL!
const SB_HEADERS = { "apikey": process.env.SUPABASE_SERVICE_KEY!, "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" }

// Expansions are also kept in Supabase (query_expansions, list_seven.sql) for 30 days, so a query
// only pays for the LLM once across all server instances.
async function storedExpansion(key: string): Promise<{ english: string, terms: string[] } | null> {
  try {
    const since = encodeURIComponent(new Date(Date.now() - 30 * 86400000).toISOString())
    const r = await fetch(`${SB_URL}/rest/v1/query_expansions?select=english,terms&query=eq.${encodeURIComponent(key)}&updated_at=gte.${since}`, { headers: SB_HEADERS, signal: AbortSignal.timeout(1500) })
    const [row] = r.ok ? await r.json() : []
    return row ? { english: row.english, terms: row.terms || [] } : null
  } catch { return null }
}

async function expandQuery(query: string, tier: Tier, mayUseLlm: () => Promise<boolean>): Promise<{ english: string, terms: string[], unavailable?: boolean }> {
  const key = query.toLowerCase().trim()
  if (!key || key.split(/\s+/).length > 8) return { english: query, terms: [] }
  const cached = expansionCache.get(key)
  if (cached && cached.expires > Date.now()) return cached
  const stored = await storedExpansion(key)
  if (stored) { expansionCache.set(key, { ...stored, expires: Date.now() + 6 * 3600_000 }); return stored }
  // Crowded: free searches skip the LLM step (cached expansions above still work), so Pro goes first.
  if (!await mayUseLlm()) return { english: query, terms: [], unavailable: true }
  const answer = await complete(
    `A user searched for: "${query}". The search may be in any language. Translate it into English (unchanged if it's already English), then list up to 6 short related English search terms: synonyms, product or service categories, and common alternative words. Reply with JSON only: {"english":"...","terms":["..."]}`,
    4000,
    tier
  )
  const parsed = safeParseJSON(answer || "")
  const english = typeof parsed?.english === "string" && parsed.english.trim() ? parsed.english.trim() : query
  const words = new Set(english.toLowerCase().split(/\s+/))
  const terms: string[] = (parsed?.terms || [])
    .filter((t: unknown) => typeof t === "string")
    .map((t: string) => t.toLowerCase().trim())
    .filter((t: string) => t && t.split(/\s+/).length <= 3 && !words.has(t))
    .slice(0, 6)
  const result = { english, terms, expires: Date.now() + (answer ? 6 * 3600_000 : 2 * 60_000), ...(answer ? {} : { unavailable: true }) }
  if (answer) fetch(`${SB_URL}/rest/v1/query_expansions?on_conflict=query`, {
    method: "POST", headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify({ query: key, english, terms, updated_at: new Date().toISOString() })
  }).catch(() => {})
  // Failures are cached briefly so a struggling model isn't hit on every search.
  expansionCache.set(key, result)
  if (expansionCache.size > 2000) expansionCache.delete(expansionCache.keys().next().value!)
  return result
}

// Priority access: live crawls (the expensive path) are capped across all free users per minute.
// Above the cap, free users get the indexed copy; Pro is never capped here.
const FREE_LIVE_CRAWLS_PER_MIN = parseInt(process.env.FREE_LIVE_CRAWLS_PER_MIN || "30")

async function freeLiveCrawlAllowed(): Promise<boolean> {
  return !await isRateLimited("livecrawl:free", FREE_LIVE_CRAWLS_PER_MIN)
}

function indexedCopy(site: any): Site {
  return { domain: site.domain, name: site.name, pages: site.pages, actions: site.actions, native: site.native }
}

// A saved copy good enough to serve without crawling: real content, updated within FRESH_DAYS.
const FRESH_DAYS = parseInt(process.env.FRESH_DAYS || "14")
function freshCopy(saved: any): Site | null {
  if (!saved || !saved.actions?.length) return null
  const age = saved.updated_at ? Date.now() - Date.parse(saved.updated_at) : Infinity
  if (!saved.ownerKey && !saved.native && age > FRESH_DAYS * 86400000) return null
  const { contentHash, ownerKey, productsCrawledAt, ...site } = saved
  return site as Site
}

// Results opened for this exact search (query_clicks, list_eleven.sql), cached for 10 minutes.
const clickCache = new Map<string, { map: Map<string, number>, expires: number }>()
async function queryClicks(query: string): Promise<Map<string, number>> {
  const key = query.toLowerCase().trim().slice(0, 100)
  const hit = clickCache.get(key)
  if (hit && hit.expires > Date.now()) return hit.map
  const map = new Map<string, number>()
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/query_clicks?select=domain,clicks&query=eq.${encodeURIComponent(key)}&order=clicks.desc&limit=30`, { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(1500) })
    for (const row of r.ok ? await r.json() : []) map.set(row.domain, row.clicks)
  } catch {}
  clickCache.set(key, { map, expires: Date.now() + 600_000 })
  if (clickCache.size > 2000) clickCache.delete(clickCache.keys().next().value!)
  return map
}

function queueCrawl(domain: string) {
  later(fetch(`${SUPABASE_URL}/rest/v1/rpc/queue_crawl`, { method: "POST", headers: SUPABASE_HEADERS, body: JSON.stringify({ d: domain }), signal: AbortSignal.timeout(3000) }))
}

// Pro goes first when it's crowded: free searches share a per-minute budget for the expensive
// steps (LLM query expansion and site guessing, live crawls). Past it, free searches still get
// index results — with a notice saying it's busy — and Pro keeps the full search.
const FREE_LLM_PER_MIN = parseInt(process.env.FREE_LLM_PER_MIN || "60")

// opts.lite: heavy free use from one client (scraper guard, api/search.ts) — index only, no LLM,
// live crawls or guessing. opts.places receives OpenStreetMap places for local searches.
export type SearchOptions = { lite?: boolean, places?: any[], related?: string[] }

export async function searchSites(query: string, tier: Tier = "free", timing: Record<string, number> = {}, notices: Notice[] = [], opts: SearchOptions = {}): Promise<Site[]> {
  const mark = (name: string, since: number) => { timing[name] = (timing[name] || 0) + Date.now() - since }
  const isPro = tier === "pro"
  const parsed = parseFullUrl(query)
  let indexFailed = false
  const onIndexFail = () => { indexFailed = true }
  const retryAfter = () => llmStatus(tier).retryAfterSeconds || 60
  // Checked only when a free search is about to use the LLM (one rate-limit hit per such search).
  let llmAllowed: boolean | null = null
  const lite = !isPro && !!opts.lite
  // Heavy free use gets its own explanation instead of "it's busy".
  const busyNotice = (code: Parameters<typeof notice>[0], v: Parameters<typeof notice>[1] = {}) => notice(lite ? "heavy_use" : code, v)
  const mayUseLlm = async () => {
    if (isPro) return true
    if (lite) return false
    if (llmAllowed === null) llmAllowed = llmStatus("free").available && !await isRateLimited("llm:free", FREE_LLM_PER_MIN)
    return llmAllowed
  }
  const done = (results: Site[]): Site[] => {
    if (indexFailed && !results.length) notices.push(notice("temporarily_unavailable"))
    return results
  }

  if (parsed && parsed.path !== "/" && (isPro || await freeLiveCrawlAllowed())) {
    const page = await crawlPage(parsed.domain, parsed.path, tier)
    if (page) {
      return [{
        domain: `${parsed.domain}${parsed.path}`,
        name: page.title,
        pages: { [parsed.path]: { title: page.title, content: page.content } },
        actions: page.actions || []
      }]
    }
  }

  // Seed sites and sites this instance just crawled answer an exact domain lookup directly.
  if (parsed && sites[parsed.domain]) return [sites[parsed.domain]]
  // Speed: a domain Actuent already has (with real content, recently updated) is served from the
  // index instead of being crawled live. New, minimal or stale sites are still crawled.
  if (parsed && parsed.path === "/") {
    const fresh = freshCopy(await getSavedSite(parsed.domain))
    if (fresh) return [fresh]
  }

  // Clicks for this search (which results people opened), fetched alongside the search itself.
  let clicks = new Map<string, number>()
  const clicksReady = parsed ? Promise.resolve() : queryClicks(query).then(m => { clicks = m })
  const lang = queryLanguage(query)

  async function searchIndex(): Promise<Site[]> {
    // Only keyword queries are expanded; a domain means that exact site. Speed: the plain search,
    // the expansion (an LLM call unless cached) and then the expanded search all overlap, and the
    // expansion is only waited for briefly when the plain search already found enough results.
    const both = async (q: string) => { const t = Date.now(); const [a, b] = await Promise.all([searchSupabase(q, onIndexFail), searchPages(q, onIndexFail)]); mark(q === query ? "plain" : "expanded", t); return { sites: a, pages: b } }
    const rank = (found: { sites: Site[], pages: Site[], local?: Site[] }, primaryQuery: string, expanded: string) => {
      // The user's own words (in English) count most; related terms add a smaller boost, or a lower score on their own.
      // Coverage: a site matching every word ("dentist" and "berlin") beats one matching only some.
      // Generic words ("online", "software") count half: many good sites never say them.
      // A city in the search says where, not what: "running shoes london" is scored on "running
      // shoes", and businesses actually in London get the local bonus below.
      const place = splitCity(primaryQuery)
      const needs = localNeeds(query)
      // "shoes copenhagen": shops in Denmark (a .dk site, a Danish address, a Danish site) rank
      // above the world's big shoe shops.
      const country = place ? cityCountry(place.city) : null
      const what = (place ? place.what : primaryQuery).replace(/\b(open (now|late)|late[- ]night|tonight|today|tomorrow|this (evening|morning|weekend)|(on )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?|friendly)\b/gi, " ").replace(/\s+/g, " ").trim() || primaryQuery
      const cats = queryCategories(what)
      const words = [...new Set(what.toLowerCase().split(/\s+/).filter(w => w.length > 2).map(stem))]
      const weight = (w: string) => WEAK_WORDS.has(w) ? 0.5 : 1
      const total = words.reduce((n, w) => n + weight(w), 0)
      const coverage = (site: Site) => {
        if (words.length < 2 || !total) return 1
        const text = `${site.name} ${site.domain} ${JSON.stringify(site.pages || {})} ${JSON.stringify(site.actions || [])} ${JSON.stringify((site as any).business?.address || {})}`.toLowerCase()
        return words.filter(w => text.includes(w)).reduce((n, w) => n + weight(w), 0) / total
      }
      const score = (site: Site) => {
        const primary = scoreMatch(site, what)
        const related = expanded ? scoreMatch(site, expanded) : 0
        // The database's rank (text match, every-word bonus, popularity: list_nine.sql) counts too.
        const dbRank = Number((site as any).rank) || 0
        const base = (primary > 0 ? primary + related * 0.3 : related * 0.5) + (primary > 0 || related > 0 ? dbRank * 6 : 0)
        const c = coverage(site)
        // The kind of site the search means ("accounting software" → software/finance) ranks higher.
        const categoryBoost = cats.size && (site as any).category && cats.has((site as any).category) ? 1.3 : 1
        // Results people opened for this search before (query_clicks), up to +40%.
        const clickCount = clicks.get(site.domain) || 0
        const clickBoost = clickCount ? 1 + Math.min(0.4, Math.log2(1 + clickCount) / 12) : 1
        // Sites in the searcher's own language (a German search, a German site) rank a little higher.
        const languageBoost = lang && (site as any).language === lang ? 1.15 : 1
        // Local needs: "vegan", "dogs", "open late", "brunch sunday" (OpenStreetMap features and opening hours).
        const needsBoost = (site as any).business ? needsFactor((site as any).business, needs) : 1
        // …and shops clearly in another country (.co.uk, .ca for a Copenhagen search) rank lower.
        const tld = site.domain.split("/")[0].split(".").pop() || ""
        const elsewhere = country && tld.length === 2 && !GENERIC_CCTLDS.has(tld) && !inCountry(site as any, country)
        const countryBoost = country && inCountry(site as any, country) ? 1.6 : elsewhere ? 0.6 : 1
        return base * (0.15 + 0.85 * c * c) * categoryBoost * countryBoost * clickBoost * languageBoost * needsBoost
          * intentBoost(query, site) * freshnessBoost(query, (site as any).updated_at) * qualityFactor(site)
      }
      // Businesses in the searched city compete in the same ranking, with a bonus for the city
      // (so a gold dealer in London never beats a running shop just for "buy … London").
      const localDomains = new Set((found.local || []).map(x => x.domain))
      // (Sites this server crawled or guessed for earlier searches are kept for domain lookups
      // only: mixed in here, "password manager" guesses turned up in "car rental".)
      const ranked = [...found.sites, ...(found.local || []).filter(x => !found.sites.some(y => y.domain === x.domain))]
        .map(site => ({ site, score: score(site) * (localDomains.has(site.domain) ? 1.6 : 1) }))
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(r => ({ ...r.site, _score: r.score }) as Site)
      // An exact brand search ("nike", "stripe", "the north face") puts that brand's own site first.
      const q = primaryQuery.toLowerCase().trim()
      const brandIndex = ranked.findIndex(site => {
        const label = site.domain.replace(/^www\./, "").split(".")[0]
        return String(site.name || "").toLowerCase().trim() === q || label === q.replace(/\s+/g, "") || label === q.replace(/\s+/g, "-")
      })
      if (brandIndex > 0 && brandIndex < 15) ranked.unshift(ranked.splice(brandIndex, 1)[0])
      const seen = new Set<string>()
      const results: Site[] = []
      for (const site of [...ranked, ...found.pages]) {
        if (!seen.has(site.domain)) { seen.add(site.domain); results.push({ ...site, matched: explainMatch(site, primaryQuery, expanded, query) } as Site) }
      }
      // One result per brand (nike.com with nike.com.br folded underneath), the page that answers
      // "basecamp pricing" first, and no near-identical results in a row.
      return diversify(pageAnswerFirst(mergeRegional(results) as Site[], query))
    }
    if (parsed) return rank(await both(query), query, "")

    const te = Date.now()
    let expansionUnavailable = false
    let namedFound = false
    const expanding = expandQuery(query, tier, mayUseLlm).then(x => {
      mark("expand", te)
      if (x.unavailable) expansionUnavailable = true
      // Related searches people could try next ("running shoes" → "trail running shoes", "sneakers").
      // (Not for a name: "localilabs" isn't "lab services".)
      if (opts.related && !opts.related.length && !namedFound) opts.related.push(...x.terms.slice(0, 6))
      return x
    })
    // As soon as the expansion arrives, the expanded search starts (overlapping the plain one).
    const expandedSearch = expanding.then(async ({ english, terms }) => {
      if (english.toLowerCase() === query.toLowerCase() && !terms.length) return null
      // The original words stay in, so sites in the query's own language still match.
      // At most 4 related terms: each extra word makes the database search heavier.
      const fewer = terms.slice(0, 4)
      const fullQuery = [english !== query ? `${query} ${english}` : query, fewer.join(" ")].filter(Boolean).join(" ")
      return { english, expanded: fewer.join(" "), found: await both(fullQuery) }
    })
    // Other languages: common words are translated instantly from a built-in dictionary
    // ("zahnarzt berlin" → "dentist berlin"), so the plain search already runs in English. A query
    // that looks foreign but the dictionary couldn't translate waits for the LLM translation.
    const ml = translateKeywords(query)
    const plainQuery = ml.query
    const searchable = ml.english.length > 0 || /^[\x20-\x7e]+$/.test(query)
    // Local searches ("barber amsterdam"): businesses whose address is in that city come first.
    const place = splitCity(plainQuery)
    const localSearch = place ? localBusinesses(place.what, place.city) : Promise.resolve([])
    // A name ("localilabs", "british museum", "louvre tickets"): that site first, found directly.
    const name = nameOf(plainQuery, place?.city)
    const oneGenericWord = name.split(" ").length === 1 && queryCategories(name).size > 0
    const nameSearch: Promise<any[]> = name && !oneGenericWord && looksLikeName(name, false)
      ? brandSites(name).then(async found => {
          if (found.length) {
            // Its other projects: sites claimed by the same account, and sites its homepage links to.
            const [owned, linked] = await Promise.all([sameOwner(found[0]), linkedProjects(found[0])])
            const seen = new Set<string>()
            return [...found.slice(0, 2), ...owned.map(x => ({ ...x, matched: `same owner as ${found[0].domain}` })),
              ...linked.map(x => ({ ...x, matched: `a project linked from ${found[0].domain}` }))].filter(x => !seen.has(x.domain) && seen.add(x.domain))
          }
          // Not in the index under that name: Wikidata's official website for it, if Actuent has it.
          const domain = await officialWebsite(name)
          if (!domain) return []
          const saved = await getSavedSite(domain)
          if (!saved) { queueCrawl(domain); return [] }
          return [{ ...saved, owner_key: undefined }]
        }).catch(() => [])
      : Promise.resolve([])
    // For things you go to (barber, restaurant, dentist) the city helps find the right sites; for
    // things you buy or use online (running shoes, software) it only gets in the way.
    const PLACE_KINDS = new Set(["restaurant", "cafe", "bar", "bakery", "hotel", "hair_beauty", "spa_wellness", "fitness", "dental", "health", "museum_culture", "events", "home_services", "legal", "real_estate", "automotive", "education"])
    const goesThere = place ? [...queryCategories(place.what)].some(c => PLACE_KINDS.has(c)) : true
    // Things you buy in a city ("shoes copenhagen"): also sites that mention the country, so
    // Danish shops are among the candidates, not only the world's biggest shoe sites.
    const placeCountry = place && !goesThere ? cityCountry(place.city) : null
    const [plainFound, countryFound] = await Promise.all([
      searchable ? both(place && !goesThere ? place.what : plainQuery) : Promise.resolve({ sites: [] as Site[], pages: [] as Site[] }),
      searchable && placeCountry ? countrySites(place!.what, placeCountry, COUNTRY_INFO[placeCountry]?.lang || null) : Promise.resolve([] as Site[])
    ])
    if (countryFound.length) plainFound.sites.push(...countryFound.filter(x => !plainFound.sites.some(y => y.domain === x.domain)))
    const localSites = await localSearch
    const plain = { ...plainFound, local: localSites.map((x: any) => ({ ...x, pages: x.pages || {}, actions: x.actions || [] })) as Site[] }
    // No local websites indexed yet: places from OpenStreetMap, returned separately and labelled.
    if (place && !localSites.length && opts.places && queryCategories(place.what).size) {
      const found = await osmPlaces(place.what, place.city)
      if (found?.length) opts.places.push(...found)
    }
    const namedList = await nameSearch
    if (namedList.length) { namedFound = true; if (opts.related) opts.related.length = 0 }
    const named: Site[] = namedList.map((x: any) => ({ ...x, pages: x.pages || {}, actions: x.actions || [], owner_key: undefined, matched: x.matched || "exact name" }))
    const enough = searchable && (!ml.foreign || ml.english.length > 0) && plain.sites.length + plain.pages.length >= 3
    const tw = Date.now()
    // A name search skips the guessed related terms: they're what put "arkoselabs" and "slack"
    // next to "localilabs". The site itself, its pages and sites that mention it are what's wanted.
    const finished = named.length ? "late" as const : await Promise.race([expandedSearch, new Promise<"late">(r => setTimeout(() => r("late"), enough ? 1200 : plain.sites.length + plain.pages.length ? 5000 : 9000))])
    mark("wait", tw)
    // Busy: say the results come from a simpler search (only when there are results to qualify).
    const partial = (results: Site[]) => {
      if (expansionUnavailable && results.length) notices.push(busyNotice("busy_limited_results", { retryAfter: retryAfter() }))
      return results
    }
    await clicksReady
    const withNamed = (results: Site[]) => {
      if (!named.length) return results
      const first = new Set(named.map(n => n.domain))
      return [...named, ...results.filter(r => !first.has(r.domain))]
    }
    if (finished === "late" || finished === null) return partial(withNamed(rank(plain, plainQuery, "")))
    return partial(withNamed(rank({ sites: [...plain.sites, ...finished.found.sites], pages: [...plain.pages, ...finished.found.pages], local: plain.local }, finished.english, finished.expanded)))
  }

  // Nothing in the index for a keyword search: guess sites and crawl them (LLM), or explain why not.
  async function guess(): Promise<Site[]> {
    if (!await mayUseLlm() || !await freeOrPro()) { notices.push(busyNotice("busy_no_results", { query, retryAfter: retryAfter() })); return [] }
    const tc = Date.now(); const guessed = await suggestAndCrawl(query, new Set(), tier); mark("crawl", tc)
    if (guessed === null) { notices.push(notice("busy_no_results", { query, retryAfter: retryAfter() })); return [] }
    if (!guessed.length && !indexFailed) notices.push(notice("no_results", { query }))
    return guessed
  }
  const freeOrPro = async () => isPro || (!lite && await freeLiveCrawlAllowed())
  async function crawlDomain(domain: string): Promise<Site[]> {
    const crawled = await crawlSite(domain, tier)
    if (crawled) { sites[domain] = crawled; return [crawled] }
    notices.push(notice("site_unreachable", { domain }))
    return []
  }

  if (isPro) {
    const indexed = await searchIndex()
    if (indexed.length > 0) return done(indexed)
    if (parsed) return done(await crawlDomain(parsed.domain))
    return done(await guess())
  }

  // Free: a specific domain is crawled live, which keeps the index fresh for Pro. When free live
  // crawls are at capacity, the indexed copy is served instead.
  if (parsed) {
    if (!lite && await freeLiveCrawlAllowed()) return done(await crawlDomain(parsed.domain))
    // Too busy to visit live: the crawler adds or refreshes it within the hour (crawl_queue).
    queueCrawl(parsed.domain)
    const saved = await getSavedSite(parsed.domain)
    if (saved) { notices.push(busyNotice("busy_saved_copy", { domain: parsed.domain, updated: (saved as any).updated_at || null })); return [indexedCopy(saved)] }
    notices.push(busyNotice("busy_queued", { domain: parsed.domain, retryAfter: 3600 }))
    return done([])
  }

  // Free keyword queries ("shoes") search the index; only guess and crawl if it has nothing.
  const indexed = await searchIndex()
  if (indexed.length > 0) return done(indexed)
  return done(await guess())
}
