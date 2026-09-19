import type { VercelRequest, VercelResponse } from "@vercel/node"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")

  try {
    const [sitesRes, searchesRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=id`, {
        headers: {
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Prefer": "count=exact"
        }
      }),
      fetch(`${SUPABASE_URL}/rest/v1/searches?select=id`, {
        headers: {
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Prefer": "count=exact"
        }
      })
    ])

    const siteCount = parseInt(sitesRes.headers.get("content-range")?.split("/")[1] || "0")
    const searchCount = parseInt(searchesRes.headers.get("content-range")?.split("/")[1] || "0")

    return res.status(200).json({
      sites_indexed: siteCount,
      total_searches: searchCount
    })
  } catch {
    return res.status(500).json({ error: "Failed to fetch stats" })
  }
}
