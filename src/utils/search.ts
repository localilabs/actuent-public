import { sites, Site } from "../data/sites"

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

export function searchSites(query: string): Site[] {
  return Object.values(sites)
    .map(site => ({ site, score: scoreMatch(site, query) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(r => r.site)
}
