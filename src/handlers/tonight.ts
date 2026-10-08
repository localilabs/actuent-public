import type { VercelRequest, VercelResponse } from "@vercel/node"
import { mergeDuplicates } from "../utils/event_merge"
import { tonightWindow, zoneForCity, localTime } from "../utils/tonight"

// GET /api/tonight?city=Copenhagen — events tonight (until 5 am local) that websites publish, with
// their local start time and a link to tickets or details. Without ?city=, the visitor's city (from
// Vercel's location header). Events on betting, adult or gambling sites are left out.

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }
const BETTING = /\b(betting|odds|prediction|casino|bookmaker|prognoz|apuestas|pronostic|wetten)\b|прогноз|ставк/i

const cleanCity = (v: string) => v.replace(/[,()*%\\"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  const asked = cleanCity(String(req.query.city || ""))
  let fromHeader = ""
  try { fromHeader = cleanCity(decodeURIComponent(String(req.headers["x-vercel-ip-city"] || ""))) } catch {}
  const city = asked || fromHeader
  // A city in the address can be shared-cached; "near me" answers depend on the visitor.
  res.setHeader("Cache-Control", asked ? "public, max-age=0, s-maxage=900, stale-while-revalidate=1800" : "private, no-store")
  if (!city) return res.status(400).json({ error: "Add ?city=, e.g. /api/tonight?city=Copenhagen" })

  const zone = zoneForCity(city, asked ? null : String(req.headers["x-vercel-ip-country"] || "") || null)
  const { from, to } = tonightWindow(zone)
  const pattern = encodeURIComponent(`*${city.replace(/ /g, "*")}*`)
  const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_events?select=name,url,domain,start_date,end_date,venue,city,price,currency,online&or=(city.ilike.${pattern},venue.ilike.${pattern})&start_date=gte.${encodeURIComponent(from.toISOString())}&start_date=lte.${encodeURIComponent(to.toISOString())}&order=start_date.asc&limit=80`, { headers: HEADERS, signal: AbortSignal.timeout(5000) }).catch(() => null)
  if (!r?.ok) { res.setHeader("Cache-Control", "no-store"); return res.status(503).json({ error: "Too many people are exploring with Lawpy right now! Give him a minute to catch his breath." }) }
  const rows: any[] = mergeDuplicates(await r.json())
  const domains = [...new Set(rows.map(e => e.domain))]
  const hidden = new Set<string>()
  if (domains.length) {
    const c = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=domain&category=in.(adult,gambling)&domain=in.(${encodeURIComponent(domains.map(d => `"${d}"`).join(","))})`, { headers: HEADERS }).catch(() => null)
    for (const row of c?.ok ? await c.json() : []) hidden.add(row.domain)
  }
  const events = rows.filter(e => !hidden.has(e.domain) && !BETTING.test(`${e.name} ${e.url}`)).slice(0, 40)
    .map(e => ({ ...e, starts: localTime(e.start_date, zone), tickets_or_details: e.url }))
  return res.status(200).json({
    city, time_zone: zone, from: from.toISOString(), until: to.toISOString(), count: events.length, events,
    ...(events.length ? {} : { message: `Nothing tonight in ${city} that Actuent knows of yet. Actuent only lists events that venues publish on their own websites.`, whats_on: `https://api.actuent.ai/site/in/${encodeURIComponent(city.toLowerCase().replace(/\s+/g, "-"))}/whats-on` })
  })
}
