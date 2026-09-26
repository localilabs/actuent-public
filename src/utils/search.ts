import { sites, Site } from "../data/sites"
import { crawlSite, crawlPage, getSavedSite } from "./crawler"
import { complete, Tier } from "./llm"
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

function getDomainAuthority(domain: string): number {
  const root = domain.replace(/^www\./, "").split("/")[0]
  return DOMAIN_AUTHORITY[root] || 20
}

function scoreMatch(site: Site, query: string): number {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  let keywordScore = 0

  for (const word of words) {
    if (site.name.toLowerCase().includes(word)) keywordScore += 3
    if (site.domain.toLowerCase().includes(word)) keywordScore += 2
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

  const authorityBoost = (getDomainAuthority(site.domain) / 100) * 5
  // Sites publishing their own LAWP rank higher, which gives sites a reason to adopt it.
  const nativeBoost = site.native ? 3 : 0

  return keywordScore + lawpBoost * 0.3 + authorityBoost + nativeBoost
}

const SUPABASE_HEADERS = {
  "apikey": SUPABASE_SERVICE_KEY,
  "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json"
}

// Full-text search runs inside Postgres (search_lawp_sites / search_lawp_pages), so every
// indexed site is searchable. Falls back to scanning a 200-row sample if the functions are missing.
async function rpc(fn: string, query: string, max: number): Promise<any[] | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: SUPABASE_HEADERS,
      body: JSON.stringify({ q: query, max_results: max })
    })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

async function fetchSample(table: string, select: string): Promise<any[]> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${select}&limit=200`, { headers: SUPABASE_HEADERS })
    if (!r.ok) return []
    return await r.json()
  } catch { return [] }
}

// Candidate sites from Postgres full-text search (scored later in searchIndex).
async function searchSupabase(query: string): Promise<Site[]> {
  const rows = await rpc("search_lawp_sites", query, 50)
    ?? await fetchSample("lawp_sites", "domain,name,pages,actions")
  return rows.map((row: any) => ({
    domain: row.domain, name: row.name, pages: row.pages || {}, actions: row.actions || [], native: !!row.native,
    updated_at: row.updated_at || undefined, language: row.language || undefined, business: row.business || undefined, category: row.category || undefined
  }))
}

async function searchPages(query: string): Promise<Site[]> {
  const rows = await rpc("search_lawp_pages", query, 50)
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
      const authorityBoost = (getDomainAuthority(row.domain) / 100) * 5
      return { row, score: score + authorityBoost }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 5)
    .map(({ row }: any) => ({
      domain: `${row.domain}${row.path}`,
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
async function suggestAndCrawl(query: string, seen: Set<string>, tier: Tier): Promise<Site[]> {
  const answer = await complete(
    `A user searched: "${query}". List up to 3 real, existing websites most relevant to this search. If the search is gibberish or no real website fits, reply with NONE. Reply with bare domains only, comma separated, no http, no explanation. Example: nike.com,adidas.com,asos.com`,
    10000,
    tier
  )
  if (!answer) {
    console.error(`suggestAndCrawl: no model could answer for "${query}"`)
    return []
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
async function expandQuery(query: string, tier: Tier): Promise<{ english: string, terms: string[] }> {
  const key = query.toLowerCase().trim()
  if (!key || key.split(/\s+/).length > 8) return { english: query, terms: [] }
  const cached = expansionCache.get(key)
  if (cached && cached.expires > Date.now()) return cached
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
  const result = { english, terms, expires: Date.now() + (answer ? 6 * 3600_000 : 10 * 60_000) }
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

export async function searchSites(query: string, tier: Tier = "free"): Promise<Site[]> {
  const isPro = tier === "pro"
  const parsed = parseFullUrl(query)

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

  async function searchIndex(): Promise<Site[]> {
    // Only keyword queries are expanded; a domain means that exact site.
    const { english, terms } = parsed ? { english: query, terms: [] } : await expandQuery(query, tier)
    const expanded = terms.join(" ")
    const primaryQuery = english
    const fullQuery = [english !== query ? `${query} ${english}` : query, expanded].filter(Boolean).join(" ")

    // The user's own words (in English) count most; related terms add a smaller boost, or a lower score on their own.
    const score = (site: Site) => {
      const primary = scoreMatch(site, primaryQuery)
      const related = expanded ? scoreMatch(site, expanded) : 0
      return primary > 0 ? primary + related * 0.3 : related * 0.5
    }

    const [dbSites, pageResults] = await Promise.all([searchSupabase(fullQuery), searchPages(fullQuery)])
    const ranked = [...Object.values(sites), ...dbSites]
      .map(site => ({ site, score: score(site) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(r => r.site)
    const seen = new Set<string>()
    const results: Site[] = []
    for (const site of [...ranked, ...pageResults]) {
      if (!seen.has(site.domain)) { seen.add(site.domain); results.push(site) }
    }
    return results
  }

  if (isPro) {
    const indexed = await searchIndex()
    if (indexed.length > 0) return indexed
    if (parsed) {
      const crawled = await crawlSite(parsed.domain, tier)
      if (crawled) { sites[parsed.domain] = crawled; return [crawled] }
      return []
    }
    return await suggestAndCrawl(query, new Set(), tier)
  }

  // Free: a specific domain is crawled live, which keeps the index fresh for Pro. When free live
  // crawls are at capacity, the indexed copy is served instead.
  if (parsed) {
    if (await freeLiveCrawlAllowed()) {
      const crawled = await crawlSite(parsed.domain, tier)
      if (crawled) { sites[parsed.domain] = crawled; return [crawled] }
      return []
    }
    const saved = await getSavedSite(parsed.domain)
    return saved ? [indexedCopy(saved)] : []
  }

  // Free keyword queries ("shoes") search the index; only guess and crawl if it has nothing.
  const indexed = await searchIndex()
  if (indexed.length > 0) return indexed
  return await freeLiveCrawlAllowed() ? await suggestAndCrawl(query, new Set(), tier) : []
}
