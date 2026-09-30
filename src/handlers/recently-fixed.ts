import type { VercelRequest, VercelResponse } from "@vercel/node"

// GET /api/recently-fixed — sites whose agent-readiness score rose after someone ran the checklist on
// them: this week's top movers (weekly_report.ts) that were checked in the last 60 days (checkups).
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  const get = (p: string) => fetch(`${SUPABASE_URL}/rest/v1/${p}`, { headers: HEADERS, signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.json() : []).catch(() => [])
  const reports: any[] = await get("weekly_reports?select=week,data&order=week.desc&limit=4")
  const movers = new Map<string, { domain: string, from: number, to: number }>()
  for (const r of reports) for (const m of r.data?.movers || []) if (!movers.has(m.domain)) movers.set(m.domain, m)
  const since = new Date(Date.now() - 60 * 86400000).toISOString()
  const checked: any[] = movers.size ? await get(`checkups?select=domain,first_score&last_checked_at=gte.${encodeURIComponent(since)}&domain=in.(${encodeURIComponent([...movers.keys()].map(d => `"${d}"`).join(","))})`) : []
  const fixed = checked.map(c => { const m = movers.get(c.domain)!; return { domain: c.domain, from: c.first_score ?? m.from, to: m.to } }).filter(x => x.to > x.from).sort((a, b) => (b.to - b.from) - (a.to - a.from)).slice(0, 10)
  res.setHeader("Cache-Control", "public, max-age=600, s-maxage=3600")
  return res.status(200).json({ count: fixed.length, sites: fixed })
}
