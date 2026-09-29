import type { VercelRequest, VercelResponse } from "@vercel/node"

// /api/similar?domain=…: sites like this one ("sites like notion.so"). Two signals:
//   • the same kind of site (category) that shares its main words (from its name and homepage), and
//   • sites people opened for the same searches (query_clicks).
// Well-known sites first. Cached at the CDN for a day.

const SUPABASE_URL = process.env.SUPABASE_URL!
const HEADERS = { "apikey": process.env.SUPABASE_SERVICE_KEY!, "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}` }
const STOP = new Set("the and for with your you our are from that this all more have has can get how what who new now best free online app apps site website web home page welcome official about into over just make made use using used most every their them they its it's".split(" "))

async function rows(path: string, ms = 4000): Promise<any[]> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS, signal: AbortSignal.timeout(ms) })
    const d = r.ok ? await r.json() : []
    return Array.isArray(d) ? d : []
  } catch { return [] }
}

// The site's main words: its homepage title and summary, most frequent first.
function mainWords(site: any): string[] {
  const brand = site.domain.split(".")[0]
  const home: any = Object.values(site.pages || {})[0] || {}
  const text = `${home.title || ""} ${home.content || ""}`.toLowerCase()
  const counts = new Map<string, number>()
  for (const w of text.match(/[a-z]{4,}/g) || []) if (!STOP.has(w) && w !== brand) counts.set(w, (counts.get(w) || 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w]) => w)
}

export async function similarSites(domain: string, max = 10): Promise<any[]> {
  const [site] = await rows(`lawp_sites?select=domain,name,pages,category,popularity_rank&domain=eq.${encodeURIComponent(domain)}&limit=1`)
  if (!site) return []
  const brand = domain.split(".")[0]
  const words = mainWords(site)
  const [byWords, clickedFor] = await Promise.all([
    words.length && site.category
      ? rows(`lawp_sites?select=domain,name,category,popularity_rank&status=is.null&category=eq.${encodeURIComponent(site.category)}&domain=neq.${encodeURIComponent(domain)}&search_text=wfts(english).${encodeURIComponent(words.join(" or "))}&order=popularity_rank.asc.nullslast&limit=30`)
      : Promise.resolve([]),
    rows(`query_clicks?select=query&domain=eq.${encodeURIComponent(domain)}&order=clicks.desc&limit=10`, 2000)
  ])
  // Sites opened for the same searches as this one.
  const coClicked = new Map<string, number>()
  if (clickedFor.length) {
    const list = encodeURIComponent(clickedFor.map((r: any) => `"${String(r.query).replace(/"/g, "")}"`).join(","))
    for (const r of await rows(`query_clicks?select=domain,clicks&query=in.(${list})&domain=neq.${encodeURIComponent(domain)}&limit=200`, 2000)) coClicked.set(r.domain, (coClicked.get(r.domain) || 0) + Number(r.clicks || 1))
  }
  const score = new Map<string, { site: any, score: number, why: string }>()
  byWords.forEach((s: any, i: number) => score.set(s.domain, { site: s, score: 30 - i, why: `also ${String(site.category).replace(/_/g, " ")}, about ${words.slice(0, 2).join(" and ")}` }))
  if (coClicked.size) {
    const extra = await rows(`lawp_sites?select=domain,name,category,popularity_rank&status=is.null&domain=in.(${encodeURIComponent([...coClicked.keys()].slice(0, 40).map(d => `"${d}"`).join(","))})`, 2000)
    for (const s of extra) {
      const e = score.get(s.domain) || { site: s, score: 0, why: "" }
      e.score += 10 + Math.log2(1 + (coClicked.get(s.domain) || 0)) * 5
      e.why = e.why ? `${e.why}; opened for the same searches` : "opened for the same searches"
      score.set(s.domain, e)
    }
  }
  return [...score.values()]
    .filter(e => e.site.domain.split(".")[0] !== brand)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(e => ({ domain: e.site.domain, name: e.site.name || e.site.domain, category: e.site.category || null, why: e.why }))
}

export default async function similar(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  const domain = String(req.query.domain || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").replace(/[^a-z0-9.-]/g, "")
  if (!domain) return res.status(400).json({ error: "Missing domain", message: "Use /api/similar?domain=notion.so" })
  const sites = await similarSites(domain, Math.min(20, Number(req.query.limit) || 10))
  res.setHeader("Cache-Control", sites.length ? "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800" : "public, max-age=0, s-maxage=600")
  return res.status(200).json({ domain, count: sites.length, sites, ...(sites.length ? {} : { message: `No similar sites found for ${domain} yet.` }) })
}
