// Searches that are a name ("localilabs", "noma", "british museum", "louvre tickets"): the site
// with that name comes first, found directly instead of through full-text search:
//   1. brandSites: <name>.com/.io/.ai/.dk/… and sites whose name is exactly the search.
//   2. sameOwner: sites claimed by the same account follow it (a company's other projects).
//   3. officialWebsite: when the index has no match, Wikidata's "official website" for the name
//      (free, no key), cached in name_websites (list_thirteen.sql).

const SUPABASE_URL = process.env.SUPABASE_URL!
const HEADERS = { "apikey": process.env.SUPABASE_SERVICE_KEY!, "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" }
const FIELDS = "domain,name,pages,actions,native,updated_at,language,business,category,popularity_rank,owner_key"
const TLDS = ["com", "io", "ai", "co", "app", "dev", "net", "org", "dk", "se", "no", "de", "co.uk", "fr", "nl", "es", "it", "eu"]

// Words around a name that say what you want from it, not what it's called.
const AROUND = /\b(tickets?|opening hours|hours|prices?|pricing|booking|book|reservations?|reserve|visit|website|official( site| website)?|site|menu|login|sign ?in|app|contact|address|near me|online|shop|store|careers|jobs)\b/gi
export function nameOf(q: string, city?: string | null): string {
  let n = q.toLowerCase()
  if (city) n = n.replace(new RegExp(`\\b${city.toLowerCase()}\\b`), " ")
  return n.replace(AROUND, " ").replace(/[^\p{L}\p{N}\s&'.-]/gu, " ").replace(/\s+/g, " ").trim()
}

// Generic words aren't names: "shoes", "accounting software", "coffee".
export function looksLikeName(n: string, isCategory: boolean): boolean {
  const words = n.split(" ").filter(Boolean)
  return words.length >= 1 && words.length <= 4 && n.length >= 3 && !isCategory && !/\d{3,}/.test(n)
}

async function rows(path: string, ms = 2000): Promise<any[]> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS, signal: AbortSignal.timeout(ms) })
    const data = r.ok ? await r.json() : []
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

export async function brandSites(name: string): Promise<any[]> {
  const label = name.replace(/[\s'&.]+/g, "")
  const hyphen = name.replace(/[\s'&.]+/g, "-")
  const domains = [...new Set(TLDS.flatMap(t => [`${label}.${t}`, `${hyphen}.${t}`]))]
  const list = encodeURIComponent(domains.map(d => `"${d}"`).join(","))
  const [byDomain, byName] = await Promise.all([
    rows(`lawp_sites?select=${FIELDS}&status=is.null&domain=in.(${list})`),
    rows(`lawp_sites?select=${FIELDS}&status=is.null&name=ilike.${encodeURIComponent(name.replace(/[%_*,()]/g, ""))}&limit=5`)
  ])
  const seen = new Set<string>()
  const all = [...byDomain, ...byName].filter(s => !seen.has(s.domain) && seen.add(s.domain))
  // .com first, then the best-known, then the rest.
  return all.sort((a, b) => Number(b.domain === `${label}.com`) - Number(a.domain === `${label}.com`) || (a.popularity_rank || 1e9) - (b.popularity_rank || 1e9))
}

export async function sameOwner(site: any): Promise<any[]> {
  if (!site?.owner_key) return []
  return (await rows(`lawp_sites?select=${FIELDS}&status=is.null&owner_key=eq.${encodeURIComponent(site.owner_key)}&domain=neq.${encodeURIComponent(site.domain)}&limit=8`))
}

// Wikidata: the entity best matching the name, and its "official website" (P856). null if none.
export async function officialWebsite(name: string): Promise<string | null> {
  const key = name.toLowerCase().trim().slice(0, 120)
  const cached = await rows(`name_websites?select=domain,checked_at&query=eq.${encodeURIComponent(key)}`, 1500)
  if (cached.length && Date.parse(cached[0].checked_at) > Date.now() - 30 * 86400000) return cached[0].domain || null
  let domain: string | null = null, label: string | null = null
  try {
    const ua = { "User-Agent": "Actuent/1.0 (+https://docs.actuent.ai/bot; support@localilabs.com)" }
    const found = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&uselang=en&type=item&limit=3&format=json`, { headers: ua, signal: AbortSignal.timeout(1500) }).then(r => r.json())
    const ids = (found?.search || []).map((x: any) => x.id).slice(0, 3)
    if (ids.length) {
      const ent = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join("|")}&props=claims|labels&languages=en&format=json`, { headers: ua, signal: AbortSignal.timeout(1500) }).then(r => r.json())
      for (const id of ids) {
        const url = ent?.entities?.[id]?.claims?.P856?.[0]?.mainsnak?.datavalue?.value
        if (typeof url === "string") {
          try { domain = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); label = ent.entities[id].labels?.en?.value || null; break } catch {}
        }
      }
    }
  } catch { return null } // Wikidata slow or down: don't cache, try again next time
  fetch(`${SUPABASE_URL}/rest/v1/name_websites?on_conflict=query`, {
    method: "POST", headers: { ...HEADERS, "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify({ query: key, domain, label, checked_at: new Date().toISOString() })
  }).catch(() => {})
  return domain
}
