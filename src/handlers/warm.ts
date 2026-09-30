import type { VercelRequest, VercelResponse } from "@vercel/node"

// POST /api/warm {"queries": ["running shoes", …]} — runs the database search functions for these
// searches so the parts of the search index they need stay in memory. Runs on Supabase Edge
// Functions, in the same region as the database, so each call is a few milliseconds of network
// instead of a trip to the US and back. Called by actuent-crawler's warm_index.ts every 2 hours.
// At most 2 runs per 10 minutes (it only reads, but it's still work for the database).

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" }

async function timed(fn: string, q: string): Promise<number> {
  const t = Date.now()
  await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: HEADERS, body: JSON.stringify({ q, max_results: 50 }), signal: AbortSignal.timeout(15000) }).then(r => r.arrayBuffer()).catch(() => null)
  return Date.now() - t
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store")
  if (req.method !== "POST") return res.status(405).json({ error: "POST {\"queries\": [...]}" })
  const runs = await fetch(`${SUPABASE_URL}/rest/v1/rpc/hit_counter`, { method: "POST", headers: HEADERS, body: JSON.stringify({ k: "warm-index", window_seconds: 600 }) }).then(r => r.ok ? r.json() : 0).catch(() => 0)
  if (Number(runs) > 2) return res.status(429).json({ error: "Warmed recently" })
  const body = typeof req.body === "object" && req.body ? req.body : {}
  const queries = [...new Set((Array.isArray(body.queries) ? body.queries : []).map((q: unknown) => String(q).toLowerCase().trim()).filter((q: string) => q && q.length <= 60))].slice(0, 100) as string[]
  const start = Date.now(), times: number[] = []
  let index = 0
  // Two at a time, and stop at 100 seconds (the function's time limit is 150).
  await Promise.all([0, 1].map(async () => {
    while (index < queries.length && Date.now() - start < 100000) {
      const q = queries[index++]
      const [a, b] = await Promise.all([timed("search_lawp_sites", q), timed("search_lawp_pages", q)])
      times.push(Math.max(a, b))
    }
  }))
  times.sort((a, b) => a - b)
  const pct = (p: number) => times[Math.min(times.length - 1, Math.floor(times.length * p))] || 0
  return res.status(200).json({ warmed: times.length, seconds: Math.round((Date.now() - start) / 1000), median_ms: pct(0.5), p95_ms: pct(0.95) })
}
