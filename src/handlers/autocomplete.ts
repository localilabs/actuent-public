import type { VercelRequest, VercelResponse } from "@vercel/node"

// /api/autocomplete?q=…: site names that start with (or closely resemble) what's typed, plus
// searches that start with it (from the pre-computed search expansions). Fast and cached at the CDN.

const SUPABASE_URL = process.env.SUPABASE_URL!
const HEADERS = { "apikey": process.env.SUPABASE_SERVICE_KEY!, "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" }

export default async function autocomplete(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  const q = String(req.query.q || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60)
  if (q.length < 2) return res.status(200).json({ query: q, sites: [], searches: [] })
  const clean = q.replace(/[%_*,()"]/g, "")
  const [sites, searches] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/rpc/suggest_sites`, { method: "POST", headers: HEADERS, body: JSON.stringify({ prefix: clean, max_results: 6 }), signal: AbortSignal.timeout(2000) })
      .then(r => r.ok ? r.json() : []).catch(() => []),
    fetch(`${SUPABASE_URL}/rest/v1/query_expansions?select=query&query=like.${encodeURIComponent(clean + "*")}&limit=6`, { headers: HEADERS, signal: AbortSignal.timeout(2000) })
      .then(r => r.ok ? r.json() : []).catch(() => [])
  ])
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=3600, stale-while-revalidate=86400")
  return res.status(200).json({
    query: q,
    sites: (Array.isArray(sites) ? sites : []).map((s: any) => ({ name: s.name, domain: s.domain, category: s.category || null })),
    searches: (Array.isArray(searches) ? searches : []).map((s: any) => s.query).filter((s: string) => s !== q && !/[@/:]|\d{4,}/.test(s)).slice(0, 5)
  })
}
