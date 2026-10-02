// Searches that are a name ("localilabs", "noma", "british museum", "louvre tickets"): the site
// with that name comes first, found directly instead of through full-text search:
//   1. brandSites: <name>.com/.io/.ai/.dk/… and sites whose name is exactly the search.
//   2. sameOwner: sites claimed by the same account follow it (a company's other projects).
//   2b. linkedProjects: a small company's other sites, from the links on its homepage
//       (localilabs.com → actuent.ai, rejn.app), when Actuent has them.
//   3. officialWebsite: when the index has no match, Wikidata's "official website" for the name
//      (free, no key), cached in name_websites (list_thirteen.sql).

import { fetchPublic } from "./safe-fetch"
import { USER_AGENT } from "./robots"

const SUPABASE_URL = process.env.SUPABASE_URL!
const HEADERS = { "apikey": process.env.SUPABASE_SERVICE_KEY!, "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" }
const FIELDS = "domain,name,pages,actions,native,updated_at,language,business,category,popularity_rank,owner_key"
// Endings startups and brands use (notion.so, obsidian.md, linear.app), then country endings.
const TLDS = ["com", "io", "ai", "co", "app", "dev", "net", "org", "so", "md", "me", "gg", "sh", "tv", "xyz", "tech", "cc", "us", "ca", "com.au",
  "dk", "se", "no", "fi", "de", "at", "ch", "co.uk", "fr", "nl", "be", "es", "pt", "it", "pl", "eu"]

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

async function sitesNamed(name: string): Promise<any[]> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/sites_named`, { method: "POST", headers: HEADERS, body: JSON.stringify({ n: name }), signal: AbortSignal.timeout(1500) })
    const data = r.ok ? await r.json() : []
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

export async function brandSites(name: string): Promise<any[]> {
  const label = name.replace(/[\s'&.]+/g, "")
  const hyphen = name.replace(/[\s'&.]+/g, "-")
  const domains = [...new Set(TLDS.flatMap(t => [`${label}.${t}`, `${hyphen}.${t}`]))]
  const list = encodeURIComponent(domains.map(d => `"${d}"`).join(","))
  // By domain is a primary-key lookup (instant). By name goes through sites_named()
  // (list_fifteen.sql), which uses the name index; a plain name=ilike filter can't, and read the
  // whole sites table on every name search. Without the function, only the domain lookup runs.
  const [byDomain, byName] = await Promise.all([
    rows(`lawp_sites?select=${FIELDS}&status=is.null&domain=in.(${list})`, 3000),
    sitesNamed(name)
  ])
  const seen = new Set<string>()
  const all = [...byDomain, ...byName].filter(s => !seen.has(s.domain) && seen.add(s.domain))
  // The best-known first (notion.so over an unknown notion.com), then .com, then the rest.
  return all.sort((a, b) => (a.popularity_rank || 1e9) - (b.popularity_rank || 1e9) || Number(b.domain === `${label}.com`) - Number(a.domain === `${label}.com`))
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

// Links on a homepage that aren't the company's own projects.
const NOT_PROJECTS = /(^|\.)(google|googleapis|gstatic|facebook|instagram|twitter|x|linkedin|youtube|tiktok|github|gitlab|medium|substack|discord|t|wa|apple|microsoft|cloudflare|jsdelivr|unpkg|cdnjs|fontawesome|typekit|wix|squarespace|shopify|wordpress|webflow|framer|lovable|vercel|netlify|stripe|paypal|hubspot|mailchimp|calendly|notion|figma|gravatar|w3|schema|apps|play|pinterest|reddit|threads|bsky|mastodon|producthunt|trustpilot|cookiebot|onetrust|gdpr|creativecommons)\.[a-z.]+$/
const projectCache = new Map<string, { domains: string[], expires: number }>()

// A small company's own projects: the other sites its homepage links to, that Actuent has indexed.
// Only for little-known sites (a big brand's homepage links to everything); cached for 6 hours.
export async function linkedProjects(site: any): Promise<any[]> {
  if (!site?.domain || (site.popularity_rank && site.popularity_rank <= 100000)) return []
  let domains = projectCache.get(site.domain)?.expires! > Date.now() ? projectCache.get(site.domain)!.domains : null
  // Shared between servers for a week (name_websites, key "links:<domain>").
  if (!domains) {
    const saved = await rows(`name_websites?select=label,checked_at&query=eq.${encodeURIComponent(`links:${site.domain}`)}`, 1000)
    if (saved.length && Date.parse(saved[0].checked_at) > Date.now() - 7 * 86400000) domains = String(saved[0].label || "").split(",").filter(Boolean)
  }
  if (!domains) {
    try {
      const r = await fetchPublic(`https://${site.domain}`, { headers: { "User-Agent": USER_AGENT, "Accept": "text/html" }, signal: AbortSignal.timeout(2500) })
      if (!r?.ok) throw new Error("homepage didn't answer")
      const html = (await r.text()).slice(0, 300_000)
      const own = site.domain.replace(/^www\./, "")
      const found = new Set<string>()
      for (const m of html.matchAll(/href=["']https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
        const d = m[1].toLowerCase().replace(/^www\./, "")
        if (d === own || d.endsWith(`.${own}`) || NOT_PROJECTS.test(d)) continue
        found.add(d)
      }
      domains = [...found].slice(0, 8)
      fetch(`${SUPABASE_URL}/rest/v1/name_websites?on_conflict=query`, {
        method: "POST", headers: { ...HEADERS, "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify({ query: `links:${site.domain}`, domain: null, label: domains.join(","), checked_at: new Date().toISOString() })
      }).catch(() => {})
    } catch { domains = null }
    // A homepage that didn't answer is tried again in 5 minutes, not 6 hours.
    projectCache.set(site.domain, { domains: domains || [], expires: Date.now() + (domains ? 6 * 3600_000 : 5 * 60_000) })
    domains = domains || []
    if (projectCache.size > 500) projectCache.delete(projectCache.keys().next().value!)
  }
  if (!domains.length) return []
  const list = encodeURIComponent(domains.map(d => `"${d}"`).join(","))
  return rows(`lawp_sites?select=${FIELDS}&status=is.null&domain=in.(${list})`, 1500)
}

// "museum madrid", "musée paris": the city's best-known museums from Wikidata, with their official
// websites. Wikidata's text search for museums described as being in that city ("art museum in
// Paris, France"), ranked by how many Wikipedia articles each has (the Louvre first). Free, no key;
// cached for 30 days in name_websites under "museums:<city>" (label = the domains, best-known first).
export async function cityMuseums(city: string): Promise<string[]> {
  const key = `museums:${city.toLowerCase().trim()}`.slice(0, 120)
  const cached = await rows(`name_websites?select=label,checked_at&query=eq.${encodeURIComponent(key)}`, 1500)
  if (cached.length && Date.parse(cached[0].checked_at) > Date.now() - 30 * 86400000) return String(cached[0].label || "").split(",").filter(Boolean)
  const ua = { "User-Agent": "Actuent/1.0 (+https://docs.actuent.ai/bot; support@localilabs.com)" }
  let domains: string[] = []
  try {
    const search = await fetch(`https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`museum ${city} haswbstatement:P856 haswbstatement:P31`)}&srlimit=20&format=json`, { headers: ua, signal: AbortSignal.timeout(3000) }).then(r => r.json())
    const ids: string[] = (search?.query?.search || []).map((x: any) => x.title).filter((id: string) => /^Q\d+$/.test(id))
    if (ids.length) {
      const ent = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join("|")}&props=claims|sitelinks|descriptions&languages=en&format=json`, { headers: ua, signal: AbortSignal.timeout(3000) }).then(r => r.json())
      const inCity = new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, "")}\\b`, "i")
      domains = ids.map(id => ent?.entities?.[id]).filter((e: any) => e && /museum|gallery/i.test(e.descriptions?.en?.value || "") && inCity.test(e.descriptions?.en?.value || ""))
        .map((e: any) => ({ links: Object.keys(e.sitelinks || {}).length, site: e.claims?.P856?.[0]?.mainsnak?.datavalue?.value }))
        .filter((x: any) => typeof x.site === "string").sort((a: any, b: any) => b.links - a.links)
        .map((x: any) => { try { return new URL(x.site).hostname.toLowerCase().replace(/^www\./, "") } catch { return "" } })
        .filter((d: string, i: number, all: string[]) => d && all.indexOf(d) === i).slice(0, 6)
    }
  } catch { return [] } // Wikidata slow or down: try again next time
  fetch(`${SUPABASE_URL}/rest/v1/name_websites?on_conflict=query`, {
    method: "POST", headers: { ...HEADERS, "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify({ query: key, domain: domains[0] || null, label: domains.join(","), checked_at: new Date().toISOString() })
  }).catch(() => {})
  return domains
}

// Sites Actuent has for these domains (in the given order).
export async function sitesFor(domains: string[]): Promise<any[]> {
  if (!domains.length) return []
  const list = encodeURIComponent(domains.map(d => `"${d}"`).join(","))
  const found = await rows(`lawp_sites?select=${FIELDS}&status=is.null&domain=in.(${list})`, 1500)
  return domains.map(d => found.find(s => s.domain === d)).filter(Boolean)
}

// "spotfy" → Spotify: the closest name among well-known sites (list_fourteen.sql), when it's close
// enough to be a typo. null without that function, or when nothing is close.
// Typing mistakes between two words (a swapped pair of letters counts as one: "zalanod" → "zalando").
export function typos(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
  }
  return d[a.length][b.length]
}

export async function closestName(name: string): Promise<any | null> {
  // One- or two-word names only: longer searches aren't a misspelt name.
  if (name.length < 4 || name.split(" ").length > 2) return null
  try {
    const q = name.toLowerCase()
    // Also with doubled letters made single ("ikeaa" → "ikea", "adiddas" → "adidas").
    const variants = [...new Set([q, q.replace(/(\p{L})\1+/gu, "$1")])]
    const lists = await Promise.all(variants.map(v => fetch(`${SUPABASE_URL}/rest/v1/rpc/similar_site_name`, { method: "POST", headers: HEADERS, body: JSON.stringify({ q: v }), signal: AbortSignal.timeout(2000) }).then(r => r.ok ? r.json() : []).catch(() => [])))
    const seen = new Set<string>()
    const found = lists.flat().filter((x: any) => x?.name && !seen.has(x.domain) && seen.add(x.domain))
    // Fewest typing mistakes first (then the database's similarity); at most 2 mistakes, fewer for short names.
    const scored = found.map((x: any) => ({ ...x, typos: typos(q, String(x.name).toLowerCase()) })).filter((x: any) => x.typos <= (q.length <= 5 ? 1 : 2))
      .sort((a: any, b: any) => a.typos - b.typos || b.similarity - a.similarity)
    // Only real near-misses: a loose look-alike turned everyday words into a brand ("running shoes" → Red Wing Shoes).
    const best = scored[0] || (!q.includes(" ") && Array.isArray(found) ? found.find((x: any) => x.similarity >= 0.6) : null)
    if (!best || String(best.name).toLowerCase() === name.toLowerCase()) return null
    const [site] = await sitesFor([best.domain])
    return site ? { ...site, suggested_name: best.name } : null
  } catch { return null }
}
