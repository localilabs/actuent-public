import type { VercelRequest, VercelResponse } from "@vercel/node"

// Top 100 most-searched sites this week: how often each domain appeared in search results.
// Cached for 10 minutes per instance and at the CDN.

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }

let cache: { body: unknown, expires: number } | null = null

async function build() {
  const since = new Date(Date.now() - 7 * 86400000).toISOString()
  const counts: Record<string, number> = {}
  let searches = 0
  // Up to 20K searches, in pages of 1000 (Supabase's row cap).
  for (let offset = 0; offset < 20000; offset += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/searches?select=domains&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=1000&offset=${offset}`, { headers: HEADERS })
    const rows: any[] = r.ok ? await r.json() : []
    for (const row of rows) for (const d of (row.domains || []).slice(0, 5)) counts[d] = (counts[d] || 0) + 1
    searches += rows.length
    if (rows.length < 1000) break
  }
  const sites = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 100)
    .map(([domain, appearances], i) => ({ rank: i + 1, domain, appearances, page: `https://api.actuent.ai/site/${domain}` }))
  return { period: "7d", searches_counted: searches, sites, generated_at: new Date().toISOString() }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=600, stale-while-revalidate=3600")
  try {
    if (!cache || cache.expires < Date.now()) cache = { body: await build(), expires: Date.now() + 600_000 }
    return res.status(200).json(cache.body)
  } catch {
    return res.status(500).json({ error: "Could not load the leaderboard" })
  }
}
