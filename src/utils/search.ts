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
  let score = 0
  for (const word of words) {
    if (site.name.toLowerCase().includes(word)) score += 3
    if (site.domain.toLowerCase().includes(word)) score += 2
    for (const page of Object.values(site.pages)) {
      if (page.title.toLowerCase().includes(word)) score += 2
      if (page.content.toLowerCase().includes(word)) score += 1
    }
    for (const action of site.actions) {
      for (const intent of action.intent) {
        if (intent.includes(word)) score += 3
      }
      if (action.description.toLowerCase().includes(word)) score += 2
      if (action.name.toLowerCase().includes(word)) score += 2
    }
  }
  const pageCount = Object.keys(site.pages || {}).length
  const actionCount = (site.actions || []).length
  const avgIntent = actionCount > 0
    ? site.actions.reduce((s, a) => s + (a.intent?.length || 0), 0) / actionCount : 0
  let lawpScore = 0
  if (pageCount >= 3) lawpScore += 2
  if (actionCount >= 3) lawpScore += 2
  if (avgIntent >= 5) lawpScore += 1
  score += lawpScore * 0.3
  const authority = getDomainAuthority(site.domain)
  const authorityBoost = score > 0 ? (authority / 100) * 5 : 0
  return score + authorityBoost
}

async function searchSupabase(query: string): Promise<Site[]> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=*`, {
      headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }
    })
    if (!r.ok) return []
    const rows = await r.json()
    const asSites: Site[] = rows.map((row: any) => ({
      domain: row.domain, name: row.name, pages: row.pages, actions: row.actions
    }))
    return asSites
      .map(site => ({ site, score: scoreMatch(site, query) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(r => r.site)
  } catch { return [] }
}

async function searchPages(query: string): Promise<Site[]> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_pages?select=*`, {
      headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }
    })
    if (!r.ok) return []
    const rows = await r.json()
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
        const authorityBoost = score > 0 ? (getDomainAuthority(row.domain) / 100) * 5 : 0
        return { row, score: score + authorityBoost }
      })
      .filter((r: any) => r.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 5)
      .map(({ row }: any) => ({
        domain: `${row.domain}${row.path}`,
        name: row.title,
        pages: { [row.path]: { title: row.title, content: row.content } },
        actions: row.actions || []
      }))
  } catch { return [] }
}

async function suggestDomainsForQuery(query: string): Promise<string[]> {
  try {
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [{
        role: "user",
        content: `A user searched for: "${query}". List 3 real websites (domain names only, comma separated) most likely to have relevant content. Example: nike.com,adidas.com,footlocker.com`
      }],
      temperature: 0.1
    })
    const text = completion.choices?.[0]?.message?.content?.trim() || ""
    return text.split(",").map(d => d.trim().toLowerCase()).filter(d => d.includes(".")).slice(0, 3)
  } catch { return [] }
}

function parseFullUrl(query: string): { domain: string, path: string } | null {
  const match = query.match(
    /(?:https?:\/\/)?([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,})(\/[^\s]*)?/i
  )
  if (!match) return null
  return { domain: match[1].toLowerCase(), path: match[2] || "/" }
}

export async function searchSites(query: string): Promise<Site[]> {
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

  const dbResults = await searchSupabase(query)
  const pageResults = await searchPages(query)

  const seen = new Set<string>()
  const combined: Site[] = []

  for (const site of [...seedResults, ...dbResults, ...pageResults]) {
    if (!seen.has(site.domain)) {
      seen.add(site.domain)
      combined.push(site)
    }
  }

  if (combined.length > 0) return combined

  if (parsed) {
    const crawled = await crawlSite(parsed.domain)
    if (crawled) {
      sites[parsed.domain] = crawled
      return [crawled]
    }
  }

  const suggestedDomains = await suggestDomainsForQuery(query)
  const crawledResults: Site[] = []
  for (const domain of suggestedDomains) {
    if (!seen.has(domain)) {
      const crawled = await crawlSite(domain)
      if (crawled) {
        sites[domain] = crawled
        crawledResults.push(crawled)
        seen.add(domain)
      }
    }
  }
  return crawledResults
}