import fs from "fs"
import path from "path"
import { isRateLimited } from "./limits"
import { openNow, parseOpeningHoursText, zoneOf } from "./business"

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
  "san-diego las-vegas nashville toronto vancouver montreal sydney melbourne brisbane perth auckland wellington tokyo singapore dubai" +
  " esbjerg roskilde uppsala trondheim stavanger tampere turku tallinn riga vilnius gdansk wroclaw brno bratislava ljubljana zagreb belgrade bucharest sofia thessaloniki minneapolis ottawa phoenix new-orleans salt-lake-city pittsburgh detroit honolulu calgary adelaide gold-coast christchurch osaka kyoto seoul hong-kong taipei bangkok kuala-lumpur manila jakarta bali ho-chi-minh-city mumbai bangalore delhi abu-dhabi tel-aviv cape-town johannesburg nairobi lagos marrakech cairo mexico-city buenos-aires sao-paulo rio-de-janeiro santiago bogota lima medellin doha riyadh" +
  " kolding vejle horsens randers herning silkeborg næstved naestved fredericia viborg helsingør helsingor hillerød hillerod svendborg holbæk holbaek slagelse" +
  " västerås vasteras örebro orebro linköping linkoping helsingborg jönköping jonkoping norrköping norrkoping lund umeå umea gävle gavle" +
  " bremen hanover hannover nuremberg nürnberg dortmund bonn münster munster mannheim karlsruhe freiburg kiel lübeck lubeck augsburg heidelberg").split(" ").map(c => c.replace(/-/g, " "))

// The cities search recognises, for autocomplete ("cafés in cop…" → Copenhagen).
export const CITY_NAMES: string[] = CITIES

// The country of a city in the list (for product search: shops in the shopper's market first).
const CITY_COUNTRY: Record<string, string> = {
  "kolding": "dk", "vejle": "dk", "horsens": "dk", "randers": "dk", "herning": "dk", "silkeborg": "dk", "næstved": "dk", "naestved": "dk", "fredericia": "dk", "viborg": "dk", "helsingør": "dk", "helsingor": "dk", "hillerød": "dk", "hillerod": "dk", "svendborg": "dk", "holbæk": "dk", "holbaek": "dk", "slagelse": "dk", "västerås": "se", "vasteras": "se", "örebro": "se", "orebro": "se", "linköping": "se", "linkoping": "se", "helsingborg": "se", "jönköping": "se", "jonkoping": "se", "norrköping": "se", "norrkoping": "se", "lund": "se", "umeå": "se", "umea": "se", "gävle": "se", "gavle": "se", "bremen": "de", "hanover": "de", "hannover": "de", "nuremberg": "de", "nürnberg": "de", "essen": "de", "dortmund": "de", "bonn": "de", "münster": "de", "munster": "de", "mannheim": "de", "karlsruhe": "de", "freiburg": "de", "kiel": "de", "lübeck": "de", "lubeck": "de", "augsburg": "de", "heidelberg": "de",
  copenhagen: "dk", aarhus: "dk", odense: "dk", aalborg: "dk", stockholm: "se", gothenburg: "se", malmo: "se", "malmö": "se", oslo: "no", bergen: "no",
  helsinki: "fi", reykjavik: "is", london: "gb", manchester: "gb", birmingham: "gb", leeds: "gb", glasgow: "gb", edinburgh: "gb", bristol: "gb", liverpool: "gb",
  brighton: "gb", cambridge: "gb", oxford: "gb", cardiff: "gb", belfast: "gb", dublin: "ie", cork: "ie", amsterdam: "nl", rotterdam: "nl", utrecht: "nl",
  "the hague": "nl", eindhoven: "nl", brussels: "be", antwerp: "be", ghent: "be", bruges: "be", berlin: "de", hamburg: "de", munich: "de", cologne: "de",
  frankfurt: "de", stuttgart: "de", dusseldorf: "de", "düsseldorf": "de", leipzig: "de", dresden: "de", vienna: "at", salzburg: "at", zurich: "ch", geneva: "ch",
  basel: "ch", paris: "fr", lyon: "fr", marseille: "fr", nice: "fr", bordeaux: "fr", toulouse: "fr", lille: "fr", nantes: "fr", madrid: "es", barcelona: "es",
  valencia: "es", seville: "es", malaga: "es", bilbao: "es", lisbon: "pt", porto: "pt", rome: "it", milan: "it", florence: "it", venice: "it", naples: "it",
  turin: "it", bologna: "it", prague: "cz", warsaw: "pl", krakow: "pl", budapest: "hu", athens: "gr", istanbul: "tr", toronto: "ca", vancouver: "ca",
  montreal: "ca", sydney: "au", melbourne: "au", brisbane: "au", perth: "au", auckland: "nz", wellington: "nz", tokyo: "jp", singapore: "sg", dubai: "ae",
  // Cities the OpenStreetMap job covers (2026-09-29).
  "new york": "us", brooklyn: "us", "los angeles": "us", "san francisco": "us", chicago: "us", boston: "us", seattle: "us", austin: "us", denver: "us", portland: "us", washington: "us", miami: "us", esbjerg: "dk", roskilde: "dk", uppsala: "se", trondheim: "no", stavanger: "no", tampere: "fi", turku: "fi", tallinn: "ee", riga: "lv", vilnius: "lt", gdansk: "pl", wroclaw: "pl", brno: "cz", bratislava: "sk", ljubljana: "si", zagreb: "hr", belgrade: "rs", bucharest: "ro", sofia: "bg", thessaloniki: "gr", philadelphia: "us", "san diego": "us", nashville: "us", atlanta: "us", minneapolis: "us", ottawa: "ca", houston: "us", dallas: "us", phoenix: "us", "las vegas": "us", "new orleans": "us", "salt lake city": "us", pittsburgh: "us", detroit: "us", honolulu: "us", calgary: "ca", adelaide: "au", "gold coast": "au", christchurch: "nz", osaka: "jp", kyoto: "jp", seoul: "kr", "hong kong": "hk", taipei: "tw", bangkok: "th", "kuala lumpur": "my", manila: "ph", jakarta: "id", bali: "id", "ho chi minh city": "vn", mumbai: "in", bangalore: "in", delhi: "in", "abu dhabi": "ae", "tel aviv": "il", "cape town": "za", johannesburg: "za", nairobi: "ke", lagos: "ng", marrakech: "ma", cairo: "eg", "mexico city": "mx", "buenos aires": "ar", "sao paulo": "br", "rio de janeiro": "br", santiago: "cl", bogota: "co", lima: "pe", medellin: "co", doha: "qa", riyadh: "sa"
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
      const open = openNow(b.opening_hours, b.address?.country, new Date(), b.special_hours, Number(b.geo?.lon))
      const rating = Number(b.rating?.value) || 0
      const reviews = Number(b.rating?.count) || 0
      return (open === true ? 3 : open === false ? -1 : 0) + (reviews >= 5 ? rating / 2.5 : 0) - i * 0.15
    }
    return found.map((x: any, i: number) => ({ x, s: score(x, i) })).sort((a: any, b: any) => b.s - a.s).map((r: any) => r.x)
  } catch { return [] }
}

// OpenStreetMap places for "<what> in <city>" when the index has no local websites. One request,
// shared across all users at a gentle rate (OpenStreetMap's usage policy).
// Place kinds and the OpenStreetMap types that count as them.
const PLACE_TYPES: Record<string, string[]> = {
  cafe: ["cafe", "coffee"], coffee: ["cafe", "coffee"], restaurant: ["restaurant", "fast_food", "food_court"], bar: ["bar", "pub", "biergarten"], pub: ["pub", "bar"],
  bakery: ["bakery", "pastry"], pharmacy: ["pharmacy", "chemist"], hairdresser: ["hairdresser", "barber", "beauty"], supermarket: ["supermarket", "convenience", "grocery"],
  hotel: ["hotel", "hostel", "guest_house", "motel"], museum: ["museum", "gallery"], gym: ["fitness_centre", "sports_centre"], "fitness centre": ["fitness_centre"],
  cinema: ["cinema"], library: ["library"], dentist: ["dentist"], doctors: ["doctors", "clinic"], "ice cream": ["ice_cream"], "fast food": ["fast_food"]
}

// Same question, same places for 30 minutes: OpenStreetMap's free services limit how often one
// server may ask, and on launch day many people ask the same things.
const osmCache = new Map<string, { at: number, list: any[] }>()
// Places built ahead of time for the biggest US cities (scripts/build_places.mjs, weekly): instant, and
// no dependence on OpenStreetMap's free servers. Opening hours are kept; open-now is worked out here.
const builtPlaces = new Map<string, any>()
function prebuilt(what: string, word: string, city: string): any[] | null {
  const name = city.toLowerCase().replace(/\s+/g, "-")
  if (!/^[a-z-]{2,40}$/.test(name)) return null
  if (!builtPlaces.has(name)) {
    try { builtPlaces.set(name, JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "places", `${name}.json`), "utf8")).kinds || null) } catch { builtPlaces.set(name, null) }
  }
  const c = builtPlaces.get(name)
  if (!c) return null
  // "bars open late", "dog friendly cafes": the kind of place, then what it should have and when.
  const said = what.toLowerCase().replace(NEED_WORDS, " ").replace(/\s+/g, " ").trim() || what.toLowerCase().trim(), w = word.toLowerCase().trim()
  const keys = [said, said.replace(/s$/, ""), w, w.replace(/s$/, ""), ...(PREBUILT_ALIASES[said] || PREBUILT_ALIASES[said.replace(/s$/, "")] || [])]
  const list: any[] | undefined = keys.map(k => c[k]).find((l: any) => Array.isArray(l) && l.length)
  if (!list) return null
  const lon0 = Number(list[0]?.lon)
  const needs = localNeeds(what, zoneOf("US", lon0) || "America/New_York")
  let places = list.map(({ chain, lat, lon, ...p }: any) => {
    const hours = p.opening_hours ? parseOpeningHoursText(p.opening_hours) : []
    return { ...p, lat, lon, hours, open_now: /^24\/7$/.test(p.opening_hours || "") ? true : hours.length ? openNow(hours, "US", new Date(), undefined, lon) : null }
  })
  if (needs.features.length) places = places.filter((p: any) => needs.features.every(f => (p.features || []).includes(f)))
  // A time asked for ("open late", "for brunch on sunday"): open then first, unknown hours after, closed ones out.
  if (needs.day && needs.minutes != null) places = places
    .map((p: any) => ({ p, at: /^24\/7$/.test(p.opening_hours || "") ? true : p.hours.length ? openAt(p.hours, needs.day!, needs.minutes!) : null }))
    .filter((x: any) => x.at !== false).sort((a: any, b: any) => (b.at ? 1 : 0) - (a.at ? 1 : 0)).map((x: any) => x.p)
  return places.map(({ hours, ...p }: any) => p).slice(0, 8)
}
// Words that say what a place should have or when, not what it is.
const NEED_WORDS = /\b(open late|late night|late|open now|open|now|tonight|today|tomorrow|this evening|for brunch|for dinner|for lunch|for breakfast|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(dog|pet|kid|family)[- ]friendly|with (a )?(terrace|garden|wifi|wi-fi|outdoor seating)|outdoor( seating)?|terrace|wifi|wi-fi|wheelchair( accessible)?|accessible|step[- ]free|gluten[- ]free|with dogs|for kids|good for groups|for groups|cheap|best|good|nice|cozy|cosy)\b/gi
const PREBUILT_ALIASES: Record<string, string[]> = {
  brunch: ["cafe", "restaurant"], breakfast: ["cafe", "bagel"], "coffee shops": ["cafe"], cocktail: ["bar"], "cocktail bar": ["bar"], "wine bar": ["bar"], nightlife: ["bar"],
  coffee: ["cafe"], "coffee shop": ["cafe"], espresso: ["cafe"], cafes: ["cafe"], café: ["cafe"], restaurants: ["restaurant"], food: ["restaurant"], dinner: ["restaurant"], lunch: ["restaurant"],
  bars: ["bar"], pub: ["bar"], pubs: ["bar"], drinks: ["bar"], cocktails: ["bar"], beer: ["bar"], burgers: ["burger"], tacos: ["taco"], mexican: ["taco"], burrito: ["taco"],
  barber: ["hairdresser"], haircut: ["hairdresser"], "hair salon": ["hairdresser"], groceries: ["supermarket"], "grocery store": ["supermarket"], hotels: ["hotel"],
  museums: ["museum"], gallery: ["museum"], "fitness centre": ["gym"], fitness: ["gym"], movies: ["cinema"], doughnut: ["donut"], donuts: ["donut"], bagels: ["bagel"],
  vietnamese: ["pho"], barbecue: ["bbq"], sandwich: ["deli"], sandwiches: ["deli"], "vegan food": ["vegan"], vegetarian: ["vegan"], pharmacies: ["pharmacy"], drugstore: ["pharmacy"]
}

export async function osmPlaces(what: string, city: string): Promise<any[] | null> {
  const ready = prebuilt(what, OSM_WORDS[what] || what, city)
  if (ready?.length) return ready
  const key = `${what}|${city}`.toLowerCase(), hit = osmCache.get(key)
  if (hit && Date.now() - hit.at < 30 * 60000) return hit.list
  const list = await osmPlacesLive(what, city)
  if (list?.length) { osmCache.set(key, { at: Date.now(), list }); if (osmCache.size > 500) osmCache.delete(osmCache.keys().next().value!) }
  return list
}
async function osmPlacesLive(what: string, city: string): Promise<any[] | null> {
  if (await isRateLimited("osm:search", 30)) return null
  const word = OSM_WORDS[what] || what
  // "[cafe] in Brooklyn" is OpenStreetMap's way to ask for places of that kind; without the brackets
  // "cafe in Brooklyn" matched pubs. Plain words ("sushi", a place's name) are searched as they are.
  const kind = PLACE_TYPES[word.toLowerCase().replace(/s$/, "")]
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(kind ? `[${word.replace(/s$/, "")}] in ${city}` : `${word} in ${city}`)}&format=jsonv2&limit=8&extratags=1&addressdetails=1`, { headers: OSM_HEADERS, signal: AbortSignal.timeout(5000) })
    let list = r.ok ? await r.json() : []
    if (kind && Array.isArray(list)) list = list.filter((p: any) => kind.includes(String(p.type)))
    // Big cities: the free-text search finds few ("burger in New York": none). Ask Overpass for
    // places tagged that kind or cuisine around the city centre instead.
    if (!Array.isArray(list) || list.length < 3) {
      const more = await overpassPlaces(what, word, city).catch(() => [])
      if (more.length) return more
    }
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

// Cuisines OpenStreetMap tags restaurants with ("cuisine=burger"), for "<dish> in <city>" searches.
const CUISINES: Record<string, string> = {
  burger: "burger", pizza: "pizza", sushi: "sushi", taco: "mexican|taco", mexican: "mexican|taco", ramen: "ramen|japanese", thai: "thai",
  indian: "indian", chinese: "chinese", italian: "italian", japanese: "japanese|sushi|ramen", korean: "korean", vietnamese: "vietnamese", pho: "vietnamese",
  bbq: "bbq|barbecue", barbecue: "bbq|barbecue", bagel: "bagel", donut: "donut", doughnut: "donut", steak: "steak", seafood: "seafood|fish", greek: "greek",
  french: "french", falafel: "falafel|middle_eastern", kebab: "kebab|turkish", dumpling: "dumpling|chinese", "fried chicken": "chicken", chicken: "chicken", sandwich: "sandwich|deli", deli: "deli|sandwich"
}
const centers = new Map<string, { lat: number, lon: number, country: string } | null>()
async function cityCenter(city: string): Promise<{ lat: number, lon: number, country: string } | null> {
  const key = city.toLowerCase()
  if (centers.has(key)) return centers.get(key)!
  const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=jsonv2&limit=1&addressdetails=1&featureType=city`, { headers: OSM_HEADERS, signal: AbortSignal.timeout(4000) }).catch(() => null)
  const p = r?.ok ? (await r.json())?.[0] : null
  const c = p ? { lat: Number(p.lat), lon: Number(p.lon), country: String(p.address?.country_code || "").toUpperCase() } : null
  centers.set(key, c)
  return c
}
// The public mirrors tested on 2026-10-01 all timed out, so only the main server (2–3 s answers).
const OVERPASS = ["https://overpass-api.de/api/interpreter"]
// Same question, same answer for 30 minutes (launch day: many people ask "burger in new york").
const placeCache = new Map<string, { at: number, list: any[] }>()
async function overpassPlaces(what: string, word: string, city: string): Promise<any[]> {
  const key = `${what}|${word}|${city}`.toLowerCase(), hit = placeCache.get(key)
  if (hit && Date.now() - hit.at < 30 * 60000) return hit.list
  const list = await overpassLookup(what, word, city)
  if (list.length) { placeCache.set(key, { at: Date.now(), list }); if (placeCache.size > 500) placeCache.delete(placeCache.keys().next().value!) }
  return list
}
async function overpassLookup(what: string, word: string, city: string): Promise<any[]> {
  // The searcher's own word for the cuisine ("burger"), the OpenStreetMap word for the kind ("fast food").
  const said = what.toLowerCase().trim(), w = word.toLowerCase().trim().replace(/s$/, "")
  const cuisine = CUISINES[said] || CUISINES[said.replace(/s$/, "")], kind = PLACE_TYPES[w] || PLACE_TYPES[said.replace(/s$/, "")]
  if (!kind && !cuisine) return []
  const c = await cityCenter(city)
  if (!c) return []
  const around = `(around:${cuisine ? 4000 : 2500},${c.lat},${c.lon})`
  const query = cuisine
    ? `nwr["amenity"~"^(restaurant|fast_food|cafe|food_court)$"]["cuisine"~"${cuisine}",i]${around};`
    : `nwr["amenity"~"^(${kind!.join("|")})$"]${around};nwr["shop"~"^(${kind!.join("|")})$"]${around};nwr["tourism"~"^(${kind!.join("|")})$"]${around};nwr["leisure"~"^(${kind!.join("|")})$"]${around};`
  // Overpass limits how often one address can ask: a limited or slow answer means no extra places this time.
  let els: any[] | null = null
  for (const server of OVERPASS) {
    const r = await fetch(server, {
      method: "POST", headers: { ...OSM_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(`[out:json][timeout:6];(${query});out center 60;`)}`, signal: AbortSignal.timeout(6500)
    }).catch(() => null)
    if (!r?.ok) continue
    const d: any = await r.json().catch(() => null)
    if (Array.isArray(d?.elements)) { els = d.elements; break }
  }
  if (!els) return []
  return els.filter(e => e.tags?.name && !closedPlace(e.tags.amenity || e.tags.shop, e.tags)).map(e => {
    const t = e.tags, lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon
    const hours = t.opening_hours ? parseOpeningHoursText(t.opening_hours) : []
    return {
      name: t.name, type: String(t.amenity || t.shop || t.tourism || t.leisure || "").replace(/_/g, " "),
      address: [[t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" "), t["addr:city"] || city].filter(Boolean).join(", "),
      website: t.website || t["contact:website"] || null, phone: t.phone || t["contact:phone"] || null,
      opening_hours: t.opening_hours || null,
      open_now: /^24\/7$/.test(t.opening_hours || "") ? true : hours.length ? openNow(hours, c.country, new Date(), undefined, lon) : null,
      map: `https://www.openstreetmap.org/${e.type}/${e.id}`, lat, lon, chain: !!(t.brand || t["brand:wikidata"])
    }
  })
    // Local places before chains ("best burger": Burgerhead before Burger King), then ones with
    // opening hours and a website (more useful to an assistant).
    .sort((a, b) => (a.chain ? 4 : 0) - (b.chain ? 4 : 0) + (b.opening_hours ? 2 : 0) + (b.website ? 1 : 0) - (a.opening_hours ? 2 : 0) - (a.website ? 1 : 0))
    .map(({ chain, ...p }) => p)
    .slice(0, 8)
}

export function closedPlace(type: string | undefined, tags: Record<string, string> | null | undefined): boolean {
  const t = tags || {}
  return /^(vacant|disused|abandoned|closed)$/i.test(String(type || "")) || t.shop === "vacant" || t.amenity === "vacant"
    || Object.keys(t).some(k => /^(disused|abandoned|was|demolished|removed):/.test(k)) || t.opening_hours === "closed" || t.opening_hours === "off"
}

// ----- What the searcher needs from a place, and when -----
// "vegan brunch copenhagen sunday", "bar open late", "dog friendly cafe", "dinner tonight"
const FEATURE_WORDS: [RegExp, string][] = [
  [/\bvegan|plant[- ]based\b/i, "vegan"], [/\bvegetarian|veggie\b/i, "vegetarian"], [/\bgluten[- ]free|coeliac|celiac\b/i, "gluten_free"], [/\bwheelchair|accessible|step[- ]free\b/i, "wheelchair"],
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
  // A feature counts when OpenStreetMap lists it, or when the place's own menu mentions it
  // ("vegan burger", "gluten-free pizza": schema.org menus and offers from its website).
  const menu = (Array.isArray(business.offers) ? business.offers : []).map((o: any) => `${o.name || ""} ${o.category || ""}`).join(" ").toLowerCase()
  const MENU_WORDS: Record<string, RegExp> = { vegan: /\bvegan|plant[- ]based\b/, vegetarian: /\bvegetarian|veggie\b/, gluten_free: /\bgluten[- ]free\b/ }
  for (const want of needs.features) if (has.includes(want) || (MENU_WORDS[want] && MENU_WORDS[want].test(menu))) f *= 1.3
  if (needs.day && needs.minutes != null) {
    const open = openAt(business.opening_hours, needs.day, needs.minutes)
    if (open === true) f *= 1.3
    if (open === false) f *= 0.3
  } else if (needs.day && Array.isArray(business.opening_hours) && business.opening_hours.length) {
    // "open sunday" (a day, no time): open at some point that day, or not at all.
    f *= business.opening_hours.some((h: any) => Array.isArray(h.days) && h.days.includes(needs.day)) ? 1.3 : 0.3
  }
  return f
}
