import { sites, Site } from "../data/sites"
import { crawlSite, crawlPage } from "./crawler"

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

async function searchPages(query: string): Promise<Site[]> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lawp_pages?select=*`,
      {
        headers: {
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`
        }
      }
    )
    if (!res.ok) return []
    const rows = await res.json()

    const words = query.toLowerCase().split(/\s+/).filter(Boolean)

    const scored = rows
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
                if (intent.includes(word)) score += 2
              }
            }
          }
        }
        return { row, score }
      })
      .filter((r: any) => r.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 5)

    return scored.map(({ row }: any) => ({
      domain: `${row.domain}${row.path}`,
      name: row.title,
      pages: {
        [row.path]: {
          title: row.title,
          content: row.content
        }
      },
      actions: row.actions || []
    }))
  } catch {
    return []
  }
}

function parseFullUrl(query: string): { domain: string, path: string } | null {
  const match = query.match(
    /(?:https?:\/\/)?([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,})(\/[^\s]*)?/i
  )
  if (!match) return null
  return {
    domain: match[1].toLowerCase(),
    path: match[2] || "/"
  }
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

  return []
}
