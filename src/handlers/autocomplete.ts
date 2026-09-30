import type { VercelRequest, VercelResponse } from "@vercel/node"
import { CITY_NAMES } from "../utils/local"

// /api/autocomplete?q=…: site names that start with (or closely resemble) what's typed, plus
// searches that start with it (from the pre-computed search expansions). Fast and cached at the CDN.

const SUPABASE_URL = process.env.SUPABASE_URL!
const HEADERS = { "apikey": process.env.SUPABASE_SERVICE_KEY!, "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" }

// Places: "caf" → "cafés in Copenhagen"; "sushi ber" / "sushi in ber" → "sushi in Berlin".
const PLACES = ["cafés", "restaurants", "vegan restaurants", "bars", "cocktail bars", "bakeries", "pizza", "sushi", "brunch", "coffee", "barbers", "hairdressers", "hotels", "hostels", "museums", "gyms", "yoga", "dentists", "bookshops", "vintage shops", "flower shops", "bike shops", "cinemas", "concerts", "wine bars", "breweries"]
const TOP_CITIES = ["Copenhagen", "Aarhus", "London", "Berlin", "Stockholm", "Amsterdam", "Paris", "New York"]
const title = (c: string) => c.replace(/\b\p{L}/gu, x => x.toUpperCase())
const plainText = (t: string) => t.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
function placeSuggestions(q: string): string[] {
  q = plainText(q)
  const m = q.match(/^(.+?)(?:\s+in)?\s+([\p{L} .'-]{2,})$/u)
  if (m) {
    const place = PLACES.find(p => plainText(p).startsWith(m[1]) || m[1].startsWith(plainText(p).replace(/s$/, "")))
    const cities = CITY_NAMES.filter(c => plainText(c).startsWith(m[2])).slice(0, 3)
    if (place && cities.length) return cities.map(c => `${place} in ${title(c)}`)
  }
  const places = PLACES.filter(p => plainText(p).startsWith(q)).slice(0, 2)
  return places.flatMap(p => TOP_CITIES.slice(0, places.length > 1 ? 2 : 3).map(c => `${p} in ${c}`))
}

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
    searches: [...new Set([...placeSuggestions(q), ...(Array.isArray(searches) ? searches : []).map((s: any) => s.query).filter((s: string) => s !== q && !/[@/:]|\d{4,}/.test(s))])].slice(0, 6)
  })
}
