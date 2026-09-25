import type { VercelRequest, VercelResponse } from "@vercel/node"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

let cache: { sites: number, searches: number, at: number } | null = null
const CACHE_MS = 5 * 60 * 1000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")

  if (cache && Date.now() - cache.at < CACHE_MS) {
    return res.status(200).json({
      sites_indexed: cache.sites,
      total_searches: cache.searches,
      cached: true
    })
  }

  try {
    const [sitesRes, searchesRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=id`, {
        headers: {
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Prefer": "count=exact",
          "Range-Unit": "items",
          "Range": "0-0"
        }
      }),
      fetch(`${SUPABASE_URL}/rest/v1/searches?select=id`, {
        headers: {
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Prefer": "count=exact",
          "Range-Unit": "items",
          "Range": "0-0"
        }
      })
    ])

    const siteCount = parseInt(sitesRes.headers.get("content-range")?.split("/")[1] || "0")
    const searchCount = parseInt(searchesRes.headers.get("content-range")?.split("/")[1] || "0")

    cache = { sites: siteCount, searches: searchCount, at: Date.now() }

    return res.status(200).json({
      sites_indexed: siteCount,
      total_searches: searchCount,
      cached: false
    })
  } catch {
    if (cache) {
      return res.status(200).json({ sites_indexed: cache.sites, total_searches: cache.searches, cached: true })
    }
    return res.status(500).json({ error: "Failed to fetch stats" })
  }
}