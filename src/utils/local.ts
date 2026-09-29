import { isRateLimited } from "./limits"
import { openNow } from "./business"

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

// The country of a city in the list (for product search: shops in the shopper's market first).
const CITY_COUNTRY: Record<string, string> = {
  copenhagen: "dk", aarhus: "dk", odense: "dk", aalborg: "dk", stockholm: "se", gothenburg: "se", malmo: "se", "malmö": "se", oslo: "no", bergen: "no",
  helsinki: "fi", reykjavik: "is", london: "gb", manchester: "gb", birmingham: "gb", leeds: "gb", glasgow: "gb", edinburgh: "gb", bristol: "gb", liverpool: "gb",
  brighton: "gb", cambridge: "gb", oxford: "gb", cardiff: "gb", belfast: "gb", dublin: "ie", cork: "ie", amsterdam: "nl", rotterdam: "nl", utrecht: "nl",
  "the hague": "nl", eindhoven: "nl", brussels: "be", antwerp: "be", ghent: "be", bruges: "be", berlin: "de", hamburg: "de", munich: "de", cologne: "de",
  frankfurt: "de", stuttgart: "de", dusseldorf: "de", "düsseldorf": "de", leipzig: "de", dresden: "de", vienna: "at", salzburg: "at", zurich: "ch", geneva: "ch",
  basel: "ch", paris: "fr", lyon: "fr", marseille: "fr", nice: "fr", bordeaux: "fr", toulouse: "fr", lille: "fr", nantes: "fr", madrid: "es", barcelona: "es",
  valencia: "es", seville: "es", malaga: "es", bilbao: "es", lisbon: "pt", porto: "pt", rome: "it", milan: "it", florence: "it", venice: "it", naples: "it",
  turin: "it", bologna: "it", prague: "cz", warsaw: "pl", krakow: "pl", budapest: "hu", athens: "gr", istanbul: "tr", toronto: "ca", vancouver: "ca",
  montreal: "ca", sydney: "au", melbourne: "au", brisbane: "au", perth: "au", auckland: "nz", wellington: "nz", tokyo: "jp", singapore: "sg", dubai: "ae"
}
// A country's name and main language, for "shoes copenhagen": shops in Denmark and Danish sites.
export const COUNTRY_INFO: Record<string, { name: string, lang: string | null }> = {
  dk: { name: "denmark", lang: "da" }, se: { name: "sweden", lang: "sv" }, no: { name: "norway", lang: "no" }, fi: { name: "finland", lang: "fi" },
  is: { name: "iceland", lang: "is" }, gb: { name: "uk", lang: null }, ie: { name: "ireland", lang: null }, nl: { name: "netherlands", lang: "nl" },
  be: { name: "belgium", lang: null }, de: { name: "germany", lang: "de" }, at: { name: "austria", lang: "de" }, ch: { name: "switzerland", lang: null },
  fr: { name: "france", lang: "fr" }, es: { name: "spain", lang: "es" }, pt: { name: "portugal", lang: "pt" }, it: { name: "italy", lang: "it" },
  cz: { name: "czech", lang: "cs" }, pl: { name: "poland", lang: "pl" }, hu: { name: "hungary", lang: "hu" }, gr: { name: "greece", lang: "el" },
  tr: { name: "turkey", lang: "tr" }, ca: { name: "canada", lang: null }, au: { name: "australia", lang: null }, nz: { name: "new zealand", lang: null },
  jp: { name: "japan", lang: "ja" }, sg: { name: "singapore", lang: null }, ae: { name: "uae", lang: null }, us: { name: "usa", lang: null }
}
// Whether a site is in (or made for) that country: its domain ending, its address, or its language.
export function inCountry(site: { domain: string, business?: any, language?: string | null }, country: string | null): boolean {
  if (!country) return false
  const tld = site.domain.split("/")[0].split(".").pop() || ""
  if (tld === country || (country === "gb" && tld === "uk")) return true
  const addr = String(site.business?.address?.country || "").toLowerCase()
  if (addr && (addr === country || addr === COUNTRY_INFO[country]?.name)) return true
  const lang = COUNTRY_INFO[country]?.lang
  return !!lang && site.language === lang
}

export function cityCountry(city: string | null | undefined): string | null {
  if (!city) return null
  const c = city.toLowerCase()
  return CITY_COUNTRY[c] || (/new york|brooklyn|manhattan|los angeles|san francisco|chicago|boston|seattle|austin|denver|portland|washington|miami|atlanta|dallas|houston|philadelphia|san diego|las vegas|nashville/.test(c) ? "us" : null)
}

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
    // Only what the place is ("running shoes"), not how it's asked ("buy", "cheap", "best").
    const what = `${m[1]} ${m[2]}`.replace(/\b(in|near|at|best|top|buy|cheap|cheapest|good|find|order|shop for|open now|me)\b/g, " ").replace(/\s+/g, " ").trim()
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
    const found = rows.map((x: any) => byDomain.get(x.domain)).filter(Boolean)
    // Open right now first, then better rated (schema.org or OpenStreetMap data), then relevance.
    const score = (x: any, i: number) => {
      const b = x.business || {}
      const open = openNow(b.opening_hours, b.address?.country)
      const rating = Number(b.rating?.value) || 0
      const reviews = Number(b.rating?.count) || 0
      return (open === true ? 3 : open === false ? -1 : 0) + (reviews >= 5 ? rating / 2.5 : 0) - i * 0.15
    }
    return found.map((x: any, i: number) => ({ x, s: score(x, i) })).sort((a: any, b: any) => b.s - a.s).map((r: any) => r.x)
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
    // Closed places stay in OpenStreetMap as "vacant" or "disused" for a while: never list them.
    return (Array.isArray(list) ? list : []).filter((p: any) => p.name && !closedPlace(p.type, p.extratags)).map((p: any) => ({
      name: p.name, type: String(p.type || "").replace(/_/g, " "),
      address: String(p.display_name || "").split(",").slice(1, 4).join(",").trim(),
      website: p.extratags?.website || p.extratags?.["contact:website"] || null,
      phone: p.extratags?.phone || p.extratags?.["contact:phone"] || null,
      opening_hours: p.extratags?.opening_hours || null,
      map: `https://www.openstreetmap.org/${p.osm_type}/${p.osm_id}`
    }))
  } catch { return null }
}

export function closedPlace(type: string | undefined, tags: Record<string, string> | null | undefined): boolean {
  const t = tags || {}
  return /^(vacant|disused|abandoned|closed)$/i.test(String(type || "")) || t.shop === "vacant" || t.amenity === "vacant"
    || Object.keys(t).some(k => /^(disused|abandoned|was|demolished|removed):/.test(k)) || t.opening_hours === "closed" || t.opening_hours === "off"
}

// ----- What the searcher needs from a place, and when -----
// "vegan brunch copenhagen sunday", "bar open late", "dog friendly cafe", "dinner tonight"
const FEATURE_WORDS: [RegExp, string][] = [
  [/\bvegan\b/i, "vegan"], [/\bvegetarian\b/i, "vegetarian"], [/\bgluten[- ]free\b/i, "gluten_free"], [/\bwheelchair|accessible|step[- ]free\b/i, "wheelchair"],
  [/\boutdoor|terrace|garden seating\b/i, "outdoor_seating"], [/\bwi-?fi\b/i, "wifi"], [/\bkids?|child|family[- ]friendly\b/i, "kids"], [/\bdogs?|dog[- ]friendly|pet[- ]friendly\b/i, "dogs"]
]
const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]
const DAY_WORDS: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }
const MEAL_TIME: [RegExp, number][] = [[/\bbreakfast\b/i, 8 * 60 + 30], [/\bbrunch\b/i, 11 * 60], [/\blunch\b/i, 12 * 60 + 30], [/\bdinner\b/i, 19 * 60 + 30], [/\bopen late|late[- ]night|after midnight\b/i, 23 * 60], [/\btonight|this evening\b/i, 20 * 60]]
export type LocalNeeds = { features: string[], day: string | null, minutes: number | null }

export function localNeeds(q: string, zone = "Europe/Copenhagen"): LocalNeeds {
  const features = FEATURE_WORDS.filter(([re]) => re.test(q)).map(([, f]) => f)
  const nowParts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).map(p => [p.type, p.value]))
  const today = DAYS.indexOf(String(nowParts.weekday).slice(0, 2))
  let day: number | null = null
  for (const [w, d] of Object.entries(DAY_WORDS)) if (new RegExp(`\\b${w}\\b`, "i").test(q)) day = d
  if (/\btomorrow\b/i.test(q)) day = (today + 1) % 7
  if (/\b(today|tonight|this evening|now|open now)\b/i.test(q)) day = today
  let minutes: number | null = null
  for (const [re, m] of MEAL_TIME) if (re.test(q)) minutes = m
  if (/\b(now|open now)\b/i.test(q)) minutes = Number(nowParts.hour) * 60 + Number(nowParts.minute)
  if (minutes != null && day == null) day = today
  return { features, day: day == null ? null : DAYS[day], minutes }
}

const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0) }
// Open on that day at that time, per the place's opening hours (null when the hours are unknown).
export function openAt(hours: { days: string[], opens: string, closes: string }[] | undefined, day: string, minutes: number): boolean | null {
  if (!Array.isArray(hours) || !hours.length) return null
  const prev = DAYS[(DAYS.indexOf(day) + 6) % 7]
  return hours.some(h => {
    const o = toMin(h.opens), c = toMin(h.closes)
    if (c > o) return h.days.includes(day) && minutes >= o && minutes < c
    // Past midnight: open from o on that day until c the next morning.
    return (h.days.includes(day) && minutes >= o) || (h.days.includes(prev) && minutes < c)
  })
}

// How well a place fits: 1.3× per feature it has, and 1.3× when open at the asked time (0.3× when closed).
export function needsFactor(business: any, needs: LocalNeeds): number {
  if (!business || (!needs.features.length && needs.day == null)) return 1
  let f = 1
  const has: string[] = Array.isArray(business.features) ? business.features : []
  for (const want of needs.features) if (has.includes(want)) f *= 1.3
  if (needs.day && needs.minutes != null) {
    const open = openAt(business.opening_hours, needs.day, needs.minutes)
    if (open === true) f *= 1.3
    if (open === false) f *= 0.3
  }
  return f
}
