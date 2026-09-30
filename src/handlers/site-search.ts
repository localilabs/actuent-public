import type { VercelRequest, VercelResponse } from "@vercel/node"

// GET /api/site-search?domain=nike.com&q=returns — search one site's pages as Actuent indexed them:
// its main pages (lawp_sites.pages) and deeper pages (lawp_pages). For the "Search this site" box on
// site pages, and for agents that want one site's page about something.

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }
const words = (t: string) => (t.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length > 1)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  const domain = String(req.query.domain || "").toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/[^a-z0-9.-]/g, "")
  const q = String(req.query.q || "").trim().slice(0, 100)
  if (!domain || !q) return res.status(400).json({ error: "Add ?domain=example.com&q=what you're looking for" })
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600")
  const want = words(q)
  const [site] = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=pages&domain=eq.${encodeURIComponent(domain)}`, { headers: HEADERS, signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.json() : []).catch(() => [])
  const deeper: any[] = await fetch(`${SUPABASE_URL}/rest/v1/lawp_pages?select=full_url,title,content&domain=eq.${encodeURIComponent(domain)}&search_text=wfts(simple).${encodeURIComponent(q)}&limit=20`, { headers: HEADERS, signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.json() : []).catch(() => [])
  // Also pages whose title or address has the word ("/pricing"), when their text doesn't repeat it.
  if (want.length) {
    const w = want[0].replace(/[,()*%]/g, "")
    const byTitle = await fetch(`${SUPABASE_URL}/rest/v1/lawp_pages?select=full_url,title,content&domain=eq.${encodeURIComponent(domain)}&or=${encodeURIComponent(`(title.ilike.*${w}*,full_url.ilike.*${w}*)`)}&limit=10`, { headers: HEADERS, signal: AbortSignal.timeout(4000) }).then(r => r.ok ? r.json() : []).catch(() => [])
    if (Array.isArray(byTitle)) deeper.push(...byTitle)
  }
  const score = (text: string) => { const w = new Set(words(text)); return want.filter(x => w.has(x)).length / Math.max(1, want.length) }
  const main = Object.entries(site?.pages || {}).map(([path, p]: any) => ({ url: `https://${domain}${path}`, title: p.title || path, content: String(p.content || "").slice(0, 240), score: score(`${p.title} ${p.content} ${path}`) }))
  const full = (u: string) => /^https?:\/\//.test(u) ? u : `https://${u}`
  const more = (Array.isArray(deeper) ? deeper : []).map((p: any) => ({ url: full(p.full_url), title: p.title || p.full_url, content: String(p.content || "").slice(0, 240), score: Math.max(0.5, score(`${p.title} ${p.content} ${p.full_url}`)) }))
  const seen = new Set<string>(), key = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "")
  const results = [...main, ...more].filter(r => r.score > 0 && !seen.has(key(r.url)) && seen.add(key(r.url))).sort((a, b) => b.score - a.score).slice(0, 10).map(({ score, ...r }) => r)
  return res.status(200).json({ domain, query: q, count: results.length, results, ...(results.length ? {} : { message: `Nothing about “${q}” in the pages Actuent has from ${domain}.` }) })
}
