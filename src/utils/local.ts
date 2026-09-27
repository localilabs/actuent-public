import { isRateLimited } from "./limits"

// Local searches ("barber amsterdam", "italian restaurant in london"): the city is taken out of the
// query, businesses whose address is in that city come first (search_lawp_businesses), and when
// the index has none, places come straight from OpenStreetMap — returned separately as `places`
// and labelled as such, since they're map entries rather than indexed websites.

const SUPABASE_URL = process.env.SUPABASE_URL!
const HEADERS = { "apikey": process.env.SUPABASE_SERVICE_KEY!, "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" }
const OSM_HEADERS = { "User-Agent": "Actuent/1.0 (+https://docs.actuent.ai/bot; support@localilabs.com)", "Accept-Language": "en" }

// English city names (search queries arrive translated: "københavn" → "copenhagen").
const CITIES = ("copenhagen aarhus odense aalborg stockholm gothenburg malmo malmö oslo bergen helsinki reykjavik london manchester birmingham leeds glasgow edinburgh " +
  "bristol liverpool brighton cambridge oxford cardiff belfast dublin cork amsterdam rotterdam utrecht the-hague eindhoven brussels antwerp ghent bruges berlin hamburg " +
  "munich cologne frankfurt stuttgart dusseldorf düsseldorf leipzig dresden vienna salzburg zurich geneva basel paris lyon marseille nice bordeaux toulouse lille nantes " +
  "madrid barcelona valencia seville malaga bilbao lisbon porto rome milan florence venice naples turin bologna prague warsaw krakow budapest athens istanbul " +
  "new-york brooklyn manhattan los-angeles san-francisco chicago boston seattle austin denver portland washington miami atlanta dallas houston philadelphia " +
  "san-diego las-vegas nashville toronto vancouver montreal sydney melbourne brisbane perth auckland wellington tokyo singapore dubai").split(" ").map(c => c.replace(/-/g, " "))

// Everyday words → the words OpenStreetMap's search knows (same list as the MCP nearby tool).
const OSM_WORDS: Record<string, string> = {
  coffee: "cafe", "coffee shop": "cafe", "coffee roastery": "cafe", espresso: "cafe", brunch: "cafe", breakfast: "cafe", drinks: "bar", cocktails: "bar",
  beer: "pub", barber: "hairdresser", barbershop: "hairdresser", haircut: "hairdresser", "hair salon": "hairdresser", doctor: "doctors", chemist: "pharmacy",
  vet: "veterinary", gym: "fitness centre", fitness: "fitness centre", groceries: "supermarket", food: "restaurant", dinner: "restaurant", lunch: "restaurant"
}

export function splitCity(query: string): { what: string, city: string } | null {
  const q = query.toLowerCase().replace(/[,]/g, " ").replace(/\s+/g, " ").trim()
  for (const city of CITIES) {
    const m = q.match(new RegExp(`^(.*?)\\s*(?:\\bin\\b|\\bnear\\b|\\bat\\b)?\\s*\\b${city.replace(/ /g, "\\s+")}\\b\\s*(.*)$`))
    if (!m) continue
    const what = `${m[1]} ${m[2]}`.replace(/\b(in|near|at|best|top)\b/g, " ").replace(/\s+/g, " ").trim()
    if (what) return { what, city: city.replace(/\b\w/g, c => c.toUpperCase()) }
  }
  return null
}

// Indexed websites of businesses in that city (address from schema.org or OpenStreetMap).
export async function localBusinesses(what: string, city: string, max = 10): Promise<any[]> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_lawp_businesses`, {
      method: "POST", headers: HEADERS, body: JSON.stringify({ q: what, city, max_results: max }), signal: AbortSignal.timeout(4000)
    })
    const rows = r.ok ? await r.json() : []
    if (!Array.isArray(rows) || !rows.length) return []
    // Full rows (pages and actions) for the results page.
    const list = encodeURIComponent(rows.map((x: any) => `"${x.domain}"`).join(","))
    const full = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=domain,name,pages,actions,native,updated_at,language,business,category,popularity_rank&status=is.null&domain=in.(${list})`, { headers: HEADERS, signal: AbortSignal.timeout(4000) })
    const byDomain = new Map<string, any>(((full.ok ? await full.json() : []) as any[]).map(x => [x.domain, x]))
    return rows.map((x: any) => byDomain.get(x.domain)).filter(Boolean)
  } catch { return [] }
}

// OpenStreetMap places for "<what> in <city>" when the index has no local websites. One request,
// shared across all users at a gentle rate (OpenStreetMap's usage policy).
export async function osmPlaces(what: string, city: string): Promise<any[] | null> {
  if (await isRateLimited("osm:search", 30)) return null
  const word = OSM_WORDS[what] || what
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${word} in ${city}`)}&format=jsonv2&limit=8&extratags=1&addressdetails=1`, { headers: OSM_HEADERS, signal: AbortSignal.timeout(5000) })
    const list = r.ok ? await r.json() : []
    return (Array.isArray(list) ? list : []).filter((p: any) => p.name).map((p: any) => ({
      name: p.name, type: String(p.type || "").replace(/_/g, " "),
      address: String(p.display_name || "").split(",").slice(1, 4).join(",").trim(),
      website: p.extratags?.website || p.extratags?.["contact:website"] || null,
      phone: p.extratags?.phone || p.extratags?.["contact:phone"] || null,
      opening_hours: p.extratags?.opening_hours || null,
      map: `https://www.openstreetmap.org/${p.osm_type}/${p.osm_id}`
    }))
  } catch { return null }
}
