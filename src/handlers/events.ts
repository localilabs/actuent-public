import type { VercelRequest, VercelResponse } from "@vercel/node"
import { zoneForCity, localTime } from "../utils/tonight"

// GET /api/events?city=Copenhagen&days=7 — upcoming events that venues publish on their own
// websites, for the "what's on" widget (whatson.js) and anyone else. Up to 30 days, 50 events.
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }
const BETTING = /\b(betting|odds|prediction|casino|bookmaker)\b/i

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  const city = String(req.query.city || "").replace(/[,()*%\\"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40)
  const venue = String(req.query.venue || "").toLowerCase().replace(/[^a-z0-9.-]/g, "").slice(0, 80)
  if (!city && !venue) return res.status(400).json({ error: "Add ?city=Copenhagen (or ?venue=yourvenue.com)" })
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30)
  const from = new Date(Date.now() - 2 * 3600000).toISOString(), to = new Date(Date.now() + days * 86400000).toISOString()
  const where = venue ? `domain=eq.${encodeURIComponent(venue)}` : `or=(city.ilike.${encodeURIComponent(`*${city.replace(/ /g, "*")}*`)},venue.ilike.${encodeURIComponent(`*${city.replace(/ /g, "*")}*`)})`
  const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_events?select=name,url,domain,start_date,venue,city,price,currency&${where}&start_date=gte.${encodeURIComponent(from)}&start_date=lte.${encodeURIComponent(to)}&order=start_date.asc&limit=80`, { headers: HEADERS, signal: AbortSignal.timeout(5000) }).catch(() => null)
  if (!r?.ok) { res.setHeader("Cache-Control", "no-store"); return res.status(503).json({ error: "Events aren't available right now" }) }
  const zone = zoneForCity(city || null)
  const events = (await r.json()).filter((e: any) => !BETTING.test(`${e.name} ${e.url}`)).slice(0, 50)
    .map((e: any) => ({ ...e, day: new Date(e.start_date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: zone }), starts: localTime(e.start_date, zone) }))
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=1800")
  return res.status(200).json({ city: city || null, venue: venue || null, days, count: events.length, events })
}
