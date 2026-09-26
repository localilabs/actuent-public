import type { VercelRequest, VercelResponse } from "@vercel/node"

// Public numbers for the "State of the AI web" page (humans.actuent.ai/state).
// Aggregates only; cached for 10 minutes per instance and at the CDN.

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }
const LANGUAGES = ["en", "de", "fr", "es", "nl", "it", "pt", "ja", "da", "sv"]

let cache: { body: unknown, expires: number } | null = null

async function count(table: string, filter = ""): Promise<number | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*${filter ? `&${filter}` : ""}`, {
      method: "HEAD", headers: { ...HEADERS, "Prefer": "count=exact", "Range": "0-0" }
    })
    const total = r.headers.get("content-range")?.split("/")[1]
    return total && total !== "*" ? Number(total) : null
  } catch { return null }
}

async function build() {
  const week = encodeURIComponent(new Date(Date.now() - 7 * 86400000).toISOString())
  const [sites, minimal, native, withActions, products, pages, searches, searchesWeek, ...languageCounts] = await Promise.all([
    count("lawp_sites"),
    count("lawp_sites", "actions=eq.%5B%5D"),
    count("lawp_sites", "native=eq.true"),
    count("lawp_sites", "actions=neq.%5B%5D"),
    count("lawp_items"),
    count("lawp_pages"),
    count("searches"),
    count("searches", `created_at=gte.${week}`),
    ...LANGUAGES.map(l => count("lawp_sites", `language=eq.${l}`))
  ])

  let topQueries: { query: string, searches: number }[] = []
  let topSites: { domain: string, appearances: number }[] = []
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/searches?select=query,domains&created_at=gte.${week}&order=created_at.desc&limit=5000`, { headers: HEADERS })
    const rows: any[] = r.ok ? await r.json() : []
    const q: Record<string, number> = {}, d: Record<string, number> = {}
    for (const row of rows) {
      const query = String(row.query || "").toLowerCase().trim()
      // Only show plain-word queries publicly (no URLs, emails or long strings).
      if (query && query.length <= 40 && !/[@/]|\d{4,}/.test(query)) q[query] = (q[query] || 0) + 1
      for (const domain of (row.domains || []).slice(0, 5)) d[domain] = (d[domain] || 0) + 1
    }
    topQueries = Object.entries(q).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([query, searches]) => ({ query, searches }))
    topSites = Object.entries(d).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([domain, appearances]) => ({ domain, appearances }))
  } catch {}

  return {
    sites_indexed: sites,
    sites_ai_readable: withActions,
    sites_minimal: minimal,
    sites_native_lawp: native,
    ai_readable_percent: sites && withActions != null ? Math.round((withActions / sites) * 1000) / 10 : null,
    products_indexed: products,
    pages_indexed: pages,
    searches_total: searches,
    searches_7d: searchesWeek,
    languages: LANGUAGES.map((code, i) => ({ code, sites: languageCounts[i] })).filter(l => l.sites),
    top_queries_7d: topQueries,
    top_sites_7d: topSites,
    generated_at: new Date().toISOString()
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=600, stale-while-revalidate=3600")
  if (!cache || cache.expires < Date.now()) cache = { body: await build(), expires: Date.now() + 600_000 }
  return res.status(200).json(cache.body)
}
