import { sites, Site } from "../data/sites"
import { crawlSite } from "./crawler"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

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
        if (intent.includes(word)) score += 2
      }
      if (action.description.toLowerCase().includes(word)) score += 1
    }
  }

  return score
}

async function searchSupabase(query: string): Promise<Site[]> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lawp_sites?select=*`,
      {
        headers: {
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`
        }
      }
    )
    if (!res.ok) return []
    const rows = await res.json()

    const asSites: Site[] = rows.map((row: any) => ({
      domain: row.domain,
      name: row.name,
      pages: row.pages,
      actions: row.actions
    }))

    return asSites
      .map(site => ({ site, score: scoreMatch(site, query) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(r => r.site)
  } catch {
    return []
  }
}

function extractDomain(query: string): string | null {
  const match = query.match(
    /(?:https?:\/\/)?([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,})/i
  )
  if (!match) return null
  return match[1].toLowerCase().replace(/\/$/, "")
}

export async function searchSites(query: string): Promise<Site[]> {
  const seedResults = Object.values(sites)
    .map(site => ({ site, score: scoreMatch(site, query) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(r => r.site)

  const dbResults = await searchSupabase(query)

  const seen = new Set<string>()
  const combined: Site[] = []

  for (const site of [...seedResults, ...dbResults]) {
    if (!seen.has(site.domain)) {
      seen.add(site.domain)
      combined.push(site)
    }
  }

  if (combined.length > 0) return combined

  const domain = extractDomain(query)
  if (domain) {
    const crawled = await crawlSite(domain)
    if (crawled) {
      sites[domain] = crawled
      return [crawled]
    }
  }

  return []
}
