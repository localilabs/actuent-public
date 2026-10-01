// Business details from a page's schema.org JSON-LD (what Google uses for rich results): address,
// phone, email, opening hours, price range and location. No LLM.
// Copied from actuent-crawler/business.ts — keep in sync.

export type OpeningHours = { days: string[], opens: string, closes: string }
// Holidays and other special days (schema.org OpeningHoursSpecification with validFrom/validThrough):
// closed, or open at other times, from one date to another (inclusive, the business's own dates).
export type SpecialHours = { from: string, to: string, closed?: boolean, opens?: string, closes?: string }
// A service, menu item or product the business lists with a price (e.g. "Skin fade €25").
export type Offer = { name: string, price?: number, currency?: string, category?: string }
export type Business = {
  type?: string, name?: string, telephone?: string, email?: string, price_range?: string,
  address?: { street?: string, city?: string, postcode?: string, region?: string, country?: string },
  geo?: { lat: number, lon: number }, opening_hours?: OpeningHours[]
  rating?: { value: number, count?: number, best?: number, source?: string }
  special_hours?: SpecialHours[]
  offers?: Offer[]
  // From OpenStreetMap: "vegan", "vegetarian", "gluten_free", "wheelchair", "outdoor_seating", "wifi", "dogs", "kids"; hotel stars.
  features?: string[]
  stars?: number
  source?: string
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
export function parseOpeningHoursText(text: string): OpeningHours[] {
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

const MAX_OFFERS = 40

function priceOf(o: any): { price?: number, currency?: string } {
  const spec = Array.isArray(o?.priceSpecification) ? o.priceSpecification[0] : o?.priceSpecification
  const raw = o?.price ?? o?.lowPrice ?? spec?.price ?? spec?.minPrice
  const price = raw == null ? NaN : Number(String(raw).replace(",", ".").replace(/[^\d.]/g, ""))
  const currency = o?.priceCurrency || spec?.priceCurrency
  return { ...(Number.isFinite(price) && price > 0 ? { price } : {}), ...(typeof currency === "string" ? { currency: currency.toUpperCase().slice(0, 3) } : {}) }
}

// Services, menu items and catalogue entries with prices, from Offer / OfferCatalog / Menu / Service.
function collectOffers(node: any, out: Offer[], category?: string, depth = 0) {
  if (!node || typeof node !== "object" || out.length >= MAX_OFFERS || depth > 6) return
  if (Array.isArray(node)) { node.forEach(n => collectOffers(n, out, category, depth + 1)); return }
  const type = [].concat(node["@type"] || []).join(" ")
  if (/Offer\b/.test(type) && !/OfferCatalog/.test(type)) {
    const item = node.itemOffered
    const name = (typeof item === "object" ? item?.name : null) || node.name
    if (typeof name === "string" && name.trim()) out.push({ name: name.trim().slice(0, 120), ...priceOf(node), ...(category ? { category } : {}) })
    return
  }
  if (/MenuItem|Service|Product/.test(type) && typeof node.name === "string") {
    const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers
    out.push({ name: node.name.trim().slice(0, 120), ...priceOf(offer), ...(category ? { category } : {}) })
    return
  }
  // Catalogues and menus: descend, using section names as categories.
  const section = /OfferCatalog|MenuSection/.test(type) && typeof node.name === "string" ? node.name.slice(0, 60) : category
  for (const key of ["itemListElement", "hasMenuSection", "hasMenuItem", "hasOfferCatalog", "makesOffer", "hasMenu", "item"]) {
    if (node[key]) collectOffers(node[key], out, section, depth + 1)
  }
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
  const special: SpecialHours[] = []
  const soon = Date.now() + 366 * 86400000, yesterday = Date.now() - 86400000
  for (const spec of [].concat(node.openingHoursSpecification || [], node.specialOpeningHoursSpecification || [])) {
    const s: any = spec
    const opens = time(s.opens), closes = time(s.closes)
    // A date range makes it a special day (a holiday); 00:00–00:00 or no times means closed.
    const from = String(s.validFrom || "").slice(0, 10), to = String(s.validThrough || s.validFrom || "").slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      const end = Date.parse(to)
      if (Number.isFinite(end) && end >= yesterday && Date.parse(from) <= soon && special.length < 20) {
        const closed = !opens || !closes || (opens === "00:00" && closes === "00:00")
        special.push({ from, to: /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : from, ...(closed ? { closed: true } : { opens: opens!, closes: closes! }) })
      }
      continue
    }
    const days = [].concat(s.dayOfWeek || []).map(day).filter(Boolean) as string[]
    if (days.length && opens && closes) opening.push({ days, opens, closes })
  }
  if (!opening.length && node.openingHours) opening = parseOpeningHoursText([].concat(node.openingHours).join("; "))

  const r = node.aggregateRating
  const ratingValue = Number(r?.ratingValue), ratingCount = Number(r?.reviewCount ?? r?.ratingCount), best = Number(r?.bestRating)
  const rating = Number.isFinite(ratingValue) && ratingValue > 0
    ? { value: Math.round(ratingValue * 10) / 10, ...(Number.isFinite(ratingCount) && ratingCount > 0 ? { count: ratingCount } : {}), ...(Number.isFinite(best) && best > 0 && best !== 5 ? { best } : {}), source: "schema.org" }
    : pageRating(html)

  const offers: Offer[] = []
  collectOffers([node.makesOffer, node.hasOfferCatalog, node.hasMenu].filter(Boolean), offers)
  // Menus, services and offer catalogues are often separate JSON-LD blocks on the same page.
  collectOffers(nodes.filter(n => /^(Menu|OfferCatalog|Service)$/.test(types(n))), offers)
  const priced = offers.filter((o, i) => offers.findIndex(x => x.name === o.name) === i)

  const lat = Number(node.geo?.latitude), lon = Number(node.geo?.longitude)
  const business: Business = {
    type: types(node).split(" ")[0] || undefined,
    name: typeof node.name === "string" ? node.name.slice(0, 120) : undefined,
    telephone: typeof node.telephone === "string" ? node.telephone : undefined,
    email: typeof node.email === "string" ? node.email.replace(/^mailto:/, "") : undefined,
    price_range: typeof node.priceRange === "string" ? node.priceRange.slice(0, 40) : undefined,
    address: address && Object.values(address).some(Boolean) ? address : undefined,
    geo: Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined,
    opening_hours: opening.length ? opening : undefined,
    special_hours: special.length ? special : undefined,
    rating,
    offers: priced.length ? priced : undefined
  }
  // Only worth keeping if it says more than a name.
  return business.address || business.telephone || business.opening_hours || business.geo || business.offers || business.rating ? business : null
}

// A rating shown on the page itself when there's none in JSON-LD: microdata (itemprop="ratingValue"),
// or text like "Rated 4.8 out of 5 on Trustpilot" / "4.7/5 from 1,203 Google reviews". Only on a
// 5-point scale, and only with a named source or review count, so a stray "4.8" never counts.
function pageRating(html: string): Business["rating"] {
  const micro = html.match(/itemprop=["']ratingValue["'][^>]*?(?:content=["']([\d.,]+)["']|>\s*([\d.,]+))/i)
  if (micro) {
    const value = Number(String(micro[1] || micro[2]).replace(",", "."))
    const count = Number((html.match(/itemprop=["'](?:reviewCount|ratingCount)["'][^>]*?(?:content=["']([\d.,]+)["']|>\s*([\d.,]+))/i) || []).slice(1).find(Boolean)?.replace(/[.,](?=\d{3}\b)/g, ""))
    if (value > 0 && value <= 5) return { value: Math.round(value * 10) / 10, ...(count > 0 ? { count } : {}), source: "microdata" }
  }
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200000)
  const m = text.match(/\b([1-4](?:[.,]\d)?|5(?:[.,]0)?)\s*(?:\/\s*5|out of 5)(?:\s*stars?)?[^.]{0,60}?\b(trustpilot|google|tripadvisor|yelp|feefo|reviews\.io|trusted shops)\b|\b(trustpilot|google|tripadvisor|yelp|feefo)\b[^.]{0,40}?\b([1-4](?:[.,]\d)?|5(?:[.,]0)?)\s*(?:\/\s*5|out of 5)/i)
  if (!m) return undefined
  const value = Number(String(m[1] || m[4]).replace(",", "."))
  const source = String(m[2] || m[3]).toLowerCase()
  const count = Number((text.slice(Math.max(0, (m.index || 0) - 80), (m.index || 0) + 160).match(/([\d.,]{1,9})\s*(?:reviews|ratings|anmeldelser|bewertungen|avis)/i) || [])[1]?.replace(/[.,](?=\d{3}\b)/g, ""))
  return value > 0 && value <= 5 ? { value, ...(count > 0 ? { count } : {}), source } : undefined
}

// Is it open right now? Uses the business's country for its time zone (null when unknown).
export const TIME_ZONES: Record<string, string> = {
  DK: "Europe/Copenhagen", SE: "Europe/Stockholm", NO: "Europe/Oslo", FI: "Europe/Helsinki", DE: "Europe/Berlin", NL: "Europe/Amsterdam",
  BE: "Europe/Brussels", FR: "Europe/Paris", ES: "Europe/Madrid", IT: "Europe/Rome", PT: "Europe/Lisbon", AT: "Europe/Vienna",
  CH: "Europe/Zurich", PL: "Europe/Warsaw", IE: "Europe/Dublin", GB: "Europe/London", UK: "Europe/London", US: "America/New_York",
  CA: "America/Toronto", AU: "Australia/Sydney", NZ: "Pacific/Auckland", JP: "Asia/Tokyo", IN: "Asia/Kolkata", SG: "Asia/Singapore"
}
const COUNTRY_NAMES: Record<string, string> = { denmark: "DK", sweden: "SE", norway: "NO", germany: "DE", netherlands: "NL", france: "FR", spain: "ES", italy: "IT", "united kingdom": "GB", "united states": "US", ireland: "IE" }

// Special days (holidays) come first: closed on 25 December means closed, whatever the weekday says.
// Countries with several time zones: the place's longitude picks the right one (a Seattle café isn't
// on New York time).
export function zoneOf(code: string | undefined, lon?: number): string | undefined {
  const c = String(code || "").toUpperCase()
  if (lon != null && Number.isFinite(lon)) {
    if (c === "US") return lon < -115 ? "America/Los_Angeles" : lon < -101 ? "America/Denver" : lon < -87 ? "America/Chicago" : "America/New_York"
    if (c === "CA") return lon < -120 ? "America/Vancouver" : lon < -102 ? "America/Edmonton" : lon < -90 ? "America/Winnipeg" : lon < -63 ? "America/Toronto" : "America/Halifax"
    if (c === "AU") return lon < 129 ? "Australia/Perth" : lon < 141 ? "Australia/Adelaide" : "Australia/Sydney"
  }
  return TIME_ZONES[c]
}

export function openNow(hours: OpeningHours[] | undefined, country: string | undefined, now = new Date(), special?: SpecialHours[], lon?: number): boolean | null {
  if ((!hours?.length && !special?.length) || !country) return null
  const code = country.length === 2 ? country.toUpperCase() : COUNTRY_NAMES[country.toLowerCase()]
  const zone = zoneOf(code, lon)
  if (!zone) return null
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now).map(p => [p.type, p.value]))
  const today = String(parts.weekday).slice(0, 2)
  const minutes = Number(parts.hour) % 24 * 60 + Number(parts.minute)
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
  const specialToday = (special || []).find(s => s.from <= date && date <= s.to)
  if (specialToday) return specialToday.closed ? false : minutes >= toMin(specialToday.opens!) && minutes < toMin(specialToday.closes!)
  if (!hours?.length) return null
  return hours.some(h => h.days.includes(today) && (
    toMin(h.closes) > toMin(h.opens) ? minutes >= toMin(h.opens) && minutes < toMin(h.closes) : minutes >= toMin(h.opens) || minutes < toMin(h.closes)
  ))
}

// When a closed place opens next ("07:00 today", "09:00 Fri"), in its own time zone, for "nothing's
// open right now" answers. Looks up to a week ahead; null when the hours are unknown.
export function opensNext(hours: OpeningHours[] | undefined, country: string | undefined, now = new Date(), lon?: number): { at: string, in_minutes: number } | null {
  if (!hours?.length || !country) return null
  const code = country.length === 2 ? country.toUpperCase() : COUNTRY_NAMES[country.toLowerCase()]
  const zone = zoneOf(code, lon)
  if (!zone) return null
  return nextOpening(hours, zone, now)
}

const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
export function nextOpening(hours: { days: string[], opens: string }[], zone: string, now = new Date()): { at: string, in_minutes: number } | null {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now).map(p => [p.type, p.value]))
  const today = WEEK.indexOf(String(parts.weekday).slice(0, 2)), minutes = Number(parts.hour) % 24 * 60 + Number(parts.minute)
  let best: { at: string, in_minutes: number } | null = null
  for (const h of hours) for (const d of h.days) {
    const k = WEEK.indexOf(d); if (k < 0) continue
    const o = Number(h.opens.slice(0, 2)) * 60 + Number(h.opens.slice(3, 5))
    let ahead = ((k - today + 7) % 7) * 1440 + o - minutes
    if (ahead <= 0) ahead += 7 * 1440
    if (!best || ahead < best.in_minutes) { const day = Math.floor((minutes + ahead) / 1440); best = { at: `${h.opens} ${day === 0 ? "today" : day === 1 ? "tomorrow" : d}`, in_minutes: ahead } }
  }
  return best
}

// Upcoming events from schema.org Event data (concerts, classes, workshops, festivals).
// JSON-LD text sometimes still has HTML entities ("Talk &#8211; Q&amp;A").
function entities(v: string): string {
  return String(v).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
}

export type SiteEvent = {
  name: string, url: string, start_date: string, end_date?: string, description?: string,
  venue?: string, city?: string, country?: string, lat?: number, lon?: number, price?: number, currency?: string, online?: boolean
}

const EVENT_TYPES = /(^|\s)(Event|\w+Event|Festival|CourseInstance)(\s|$)/

export function extractEvents(html: string, pageUrl: string, now = new Date()): SiteEvent[] {
  const nodes: any[] = []
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { flatten(JSON.parse(m[1].trim()), nodes) } catch {}
  }
  // Events are also nested inside organisations and places ("event": [...]).
  for (const n of [...nodes]) for (const key of ["event", "events", "subEvent"]) if (n[key]) flatten(n[key], nodes)
  const out: SiteEvent[] = []
  const cutoff = now.getTime() - 86400000
  for (const n of nodes) {
    if (!EVENT_TYPES.test([].concat(n["@type"] || []).join(" ")) || typeof n.name !== "string") continue
    const start = Date.parse(n.startDate)
    if (!Number.isFinite(start) || start < cutoff || start > now.getTime() + 400 * 86400000) continue
    const end = Date.parse(n.endDate)
    const loc = Array.isArray(n.location) ? n.location[0] : n.location
    const addr = typeof loc?.address === "object" ? loc.address : null
    const online = /Online/i.test(String(n.eventAttendanceMode || "")) || /VirtualLocation/.test(String(loc?.["@type"] || ""))
    const offer = Array.isArray(n.offers) ? n.offers[0] : n.offers
    let url = pageUrl
    try { if (typeof n.url === "string") url = new URL(n.url, pageUrl).toString() } catch {}
    const lat = Number(loc?.geo?.latitude), lon = Number(loc?.geo?.longitude)
    const country = typeof addr?.addressCountry === "object" ? addr.addressCountry?.name : addr?.addressCountry
    out.push({
      name: entities(n.name).trim().slice(0, 200), url, start_date: new Date(start).toISOString(),
      ...(Number.isFinite(end) && end >= start ? { end_date: new Date(end).toISOString() } : {}),
      ...(typeof n.description === "string" ? { description: entities(n.description.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 300) } : {}),
      ...(typeof loc?.name === "string" ? { venue: entities(loc.name).slice(0, 120) } : {}),
      ...(typeof addr?.addressLocality === "string" ? { city: addr.addressLocality.slice(0, 80) } : {}),
      ...(typeof country === "string" ? { country: country.slice(0, 60) } : {}),
      ...(Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : {}),
      ...priceOf(offer),
      online
    })
    if (out.length >= 50) break
  }
  return out
}
