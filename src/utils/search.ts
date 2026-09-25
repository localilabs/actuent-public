import { sites, Site } from "../data/sites"
import { crawlSite, crawlPage } from "./crawler"
import Groq from "groq-sdk"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

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

  return keywordScore + lawpBoost * 0.3 + authorityBoost
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

async function searchSupabase(query: string): Promise<Site[]> {
  const rows = await rpc("search_lawp_sites", query, 50)
    ?? await fetchSample("lawp_sites", "domain,name,pages,actions")
  const asSites: Site[] = rows.map((row: any) => ({
    domain: row.domain, name: row.name, pages: row.pages || {}, actions: row.actions || []
  }))
  return asSites
    .map(site => ({ site, score: scoreMatch(site, query) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(r => r.site)
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

async function suggestAndCrawl(query: string, seen: Set<string>): Promise<Site[]> {
  try {
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [{
        role: "user",
        content: `User searched: "${query}". List 3 real domains most relevant. Comma separated, no http. Example: nike.com,adidas.com,asos.com`
      }],
      temperature: 0.1
    })
    const text = completion.choices?.[0]?.message?.content?.trim() || ""
    const domains = text.split(",").map(d => d.trim().toLowerCase()).filter(d => d.includes(".")).slice(0, 3)
    const results: Site[] = []
    for (const domain of domains) {
      if (!seen.has(domain)) {
        const crawled = await crawlSite(domain)
        if (crawled) { sites[domain] = crawled; results.push(crawled); seen.add(domain) }
      }
    }
    return results
  } catch { return [] }
}

export async function searchSites(query: string, tier: string = "free"): Promise<Site[]> {
  const isPro = tier === "pro"
  const parsed = parseFullUrl(query)

  if (parsed && parsed.path !== "/") {
    const page = await crawlPage(parsed.domain, parsed.path)
    if (page) {
      return [{
        domain: `${parsed.domain}${parsed.path}`,
        name: page.title,
        pages: { [parsed.path]: { title: page.title, content: page.content } },
        actions: page.actions || []
      }]
    }
  }

  const seedResults = Object.values(sites)
    .map(site => ({ site, score: scoreMatch(site, query) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(r => r.site)

  if (seedResults.length > 0) return seedResults

  if (isPro) {
    const dbResults = await searchSupabase(query)
    const pageResults = await searchPages(query)
    const seen = new Set<string>()
    const combined: Site[] = []
    for (const site of [...dbResults, ...pageResults]) {
      if (!seen.has(site.domain)) { seen.add(site.domain); combined.push(site) }
    }
    if (combined.length > 0) return combined
    if (parsed) {
      const crawled = await crawlSite(parsed.domain)
      if (crawled) { sites[parsed.domain] = crawled; return [crawled] }
      return []
    }
    return await suggestAndCrawl(query, seen)
  }

  const seen = new Set<string>()
  if (parsed) {
    const crawled = await crawlSite(parsed.domain)
    if (crawled) { sites[parsed.domain] = crawled; return [crawled] }
    return []
  }
  return await suggestAndCrawl(query, seen)
}