// Business details from a page's schema.org JSON-LD (what Google uses for rich results): address,
// phone, email, opening hours, price range and location. No LLM.
// Copied from actuent-crawler/business.ts — keep in sync.

export type OpeningHours = { days: string[], opens: string, closes: string }
export type Business = {
  type?: string, name?: string, telephone?: string, email?: string, price_range?: string,
  address?: { street?: string, city?: string, postcode?: string, region?: string, country?: string },
  geo?: { lat: number, lon: number }, opening_hours?: OpeningHours[]
}

const BUSINESS_TYPES = /LocalBusiness|Organization|Store|Restaurant|CafeOrCoffeeShop|BarOrPub|FoodEstablishment|HealthAndBeautyBusiness|HairSalon|BeautySalon|DaySpa|MedicalBusiness|Dentist|Physician|Hotel|LodgingBusiness|AutoRepair|AutomotiveBusiness|ProfessionalService|LegalService|FinancialService|RealEstateAgent|SportsActivityLocation|ExerciseGym|EntertainmentBusiness|TouristAttraction|ShoppingCenter|HomeAndConstructionBusiness|EducationalOrganization|Library|Museum/i
const DAY_NAMES: Record<string, string> = { monday: "Mo", tuesday: "Tu", wednesday: "We", thursday: "Th", friday: "Fr", saturday: "Sa", sunday: "Su", mo: "Mo", tu: "Tu", we: "We", th: "Th", fr: "Fr", sa: "Sa", su: "Su" }
const ORDER = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

function day(value: unknown): string | null {
  const key = String(value || "").split("/").pop()!.toLowerCase().replace(/[^a-z]/g, "")
  return DAY_NAMES[key] || DAY_NAMES[key.slice(0, 2)] || null
}

function time(value: unknown): string | null {
  const m = String(value || "").match(/(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null
}

// "Mo-Fr 09:00-17:00" / "Mo,We 10:00-14:00"
function parseOpeningHoursText(text: string): OpeningHours[] {
  const out: OpeningHours[] = []
  // Each group is "<day list> <open>-<close>"; day lists can mix ranges and commas ("Sa,Su", "Mo-Fr").
  for (const m of text.matchAll(/([A-Za-z]{2}(?:\s*[-,]\s*[A-Za-z]{2})*)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g)) {
    const days: string[] = []
    for (const chunk of m[1].split(",")) {
      const [a, b] = chunk.split("-").map(d => day(d.trim()))
      if (a && b) { const i = ORDER.indexOf(a), j = ORDER.indexOf(b); for (let k = i; days.length <= 7; k = (k + 1) % 7) { days.push(ORDER[k]); if (k === j) break } }
      else if (a) days.push(a)
    }
    const opens = time(m[2]), closes = time(m[3])
    if (days.length && opens && closes) out.push({ days: [...new Set(days)], opens, closes })
  }
  return out
}

function flatten(node: any, out: any[]) {
  if (!node || typeof node !== "object") return
  if (Array.isArray(node)) { node.forEach(n => flatten(n, out)); return }
  out.push(node)
  if (node["@graph"]) flatten(node["@graph"], out)
}

export function extractBusiness(html: string): Business | null {
  const nodes: any[] = []
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { flatten(JSON.parse(m[1].trim()), nodes) } catch {}
  }
  const types = (n: any) => [].concat(n["@type"] || []).join(" ")
  // Prefer a specific local business over a generic Organization.
  const node = nodes.find(n => BUSINESS_TYPES.test(types(n)) && !/^Organization$/i.test(types(n)) && (n.address || n.openingHoursSpecification || n.openingHours))
    || nodes.find(n => BUSINESS_TYPES.test(types(n)))
  if (!node) return null

  const a = Array.isArray(node.address) ? node.address[0] : node.address
  const address = a && typeof a === "object" ? {
    street: a.streetAddress || undefined, city: a.addressLocality || undefined, postcode: a.postalCode ? String(a.postalCode) : undefined,
    region: a.addressRegion || undefined, country: typeof a.addressCountry === "object" ? a.addressCountry?.name : a.addressCountry || undefined
  } : typeof a === "string" ? { street: a } : undefined

  let opening: OpeningHours[] = []
  for (const spec of [].concat(node.openingHoursSpecification || [])) {
    const s: any = spec
    const days = [].concat(s.dayOfWeek || []).map(day).filter(Boolean) as string[]
    const opens = time(s.opens), closes = time(s.closes)
    if (days.length && opens && closes) opening.push({ days, opens, closes })
  }
  if (!opening.length && node.openingHours) opening = parseOpeningHoursText([].concat(node.openingHours).join("; "))

  const lat = Number(node.geo?.latitude), lon = Number(node.geo?.longitude)
  const business: Business = {
    type: types(node).split(" ")[0] || undefined,
    name: typeof node.name === "string" ? node.name.slice(0, 120) : undefined,
    telephone: typeof node.telephone === "string" ? node.telephone : undefined,
    email: typeof node.email === "string" ? node.email.replace(/^mailto:/, "") : undefined,
    price_range: typeof node.priceRange === "string" ? node.priceRange.slice(0, 40) : undefined,
    address: address && Object.values(address).some(Boolean) ? address : undefined,
    geo: Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined,
    opening_hours: opening.length ? opening : undefined
  }
  // Only worth keeping if it says more than a name.
  return business.address || business.telephone || business.opening_hours || business.geo ? business : null
}

// Is it open right now? Uses the business's country for its time zone (null when unknown).
const TIME_ZONES: Record<string, string> = {
  DK: "Europe/Copenhagen", SE: "Europe/Stockholm", NO: "Europe/Oslo", FI: "Europe/Helsinki", DE: "Europe/Berlin", NL: "Europe/Amsterdam",
  BE: "Europe/Brussels", FR: "Europe/Paris", ES: "Europe/Madrid", IT: "Europe/Rome", PT: "Europe/Lisbon", AT: "Europe/Vienna",
  CH: "Europe/Zurich", PL: "Europe/Warsaw", IE: "Europe/Dublin", GB: "Europe/London", UK: "Europe/London", US: "America/New_York",
  CA: "America/Toronto", AU: "Australia/Sydney", NZ: "Pacific/Auckland", JP: "Asia/Tokyo", IN: "Asia/Kolkata", SG: "Asia/Singapore"
}
const COUNTRY_NAMES: Record<string, string> = { denmark: "DK", sweden: "SE", norway: "NO", germany: "DE", netherlands: "NL", france: "FR", spain: "ES", italy: "IT", "united kingdom": "GB", "united states": "US", ireland: "IE" }

export function openNow(hours: OpeningHours[] | undefined, country: string | undefined, now = new Date()): boolean | null {
  if (!hours?.length || !country) return null
  const code = country.length === 2 ? country.toUpperCase() : COUNTRY_NAMES[country.toLowerCase()]
  const zone = code && TIME_ZONES[code]
  if (!zone) return null
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now).map(p => [p.type, p.value]))
  const today = String(parts.weekday).slice(0, 2)
  const minutes = Number(parts.hour) % 24 * 60 + Number(parts.minute)
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  return hours.some(h => h.days.includes(today) && (
    toMin(h.closes) > toMin(h.opens) ? minutes >= toMin(h.opens) && minutes < toMin(h.closes) : minutes >= toMin(h.opens) || minutes < toMin(h.closes)
  ))
}
