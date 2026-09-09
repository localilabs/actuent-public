import { sites, Site } from "../data/sites"
import { crawlSite } from "./crawler"

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

export async function searchSites(query: string): Promise<Site[]> {
  const scored = Object.values(sites)
    .map(site => ({ site, score: scoreMatch(site, query) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(r => r.site)

  if (scored.length > 0) return scored

  const domainMatch = query.match(/([a-zA-Z0-9-]+\.(com|io|app|ai|co|net|org|run))/i)
  if (domainMatch) {
    const domain = domainMatch[0].toLowerCase()
    if (!sites[domain]) {
      const crawled = await crawlSite(domain)
      if (crawled) {
        sites[domain] = crawled
        return [crawled]
      }
    }
  }

  return []
}