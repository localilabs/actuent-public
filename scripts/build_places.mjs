// Builds data/places/<city>.json: places (with opening hours) for the biggest US cities and the things
// people ask for most ("cafes in brooklyn", "tacos in austin"), from OpenStreetMap's Overpass API.
// Searches read this file first, so they're instant and don't depend on OpenStreetMap's free servers
// being quick on launch day; the live lookup stays as the fallback for everything else.
// Weekly (.github/workflows/build_places.yml, four groups of cities in parallel), or:
//   CITIES_ONLY="austin,seattle" node scripts/build_places.mjs
// © OpenStreetMap contributors, ODbL.
import fs from "fs"

const HEADERS = { "User-Agent": "Actuent/1.0 (+https://docs.actuent.ai/bot; support@localilabs.com)", "Content-Type": "application/x-www-form-urlencoded" }
const CITIES = {
  "new york": [40.7549, -73.9840], manhattan: [40.7549, -73.9840], brooklyn: [40.6782, -73.9442], queens: [40.7282, -73.7949],
  "los angeles": [34.0522, -118.2437], "san francisco": [37.7749, -122.4194], chicago: [41.8818, -87.6231], austin: [30.2672, -97.7431],
  seattle: [47.6062, -122.3321], boston: [42.3601, -71.0589], miami: [25.7617, -80.1918], denver: [39.7392, -104.9903],
  washington: [38.9072, -77.0369], philadelphia: [39.9526, -75.1652], atlanta: [33.7490, -84.3880], "las vegas": [36.1147, -115.1728],
  portland: [45.5152, -122.6784], nashville: [36.1627, -86.7816], "san diego": [32.7157, -117.1611], houston: [29.7604, -95.3698], dallas: [32.7767, -96.7970]
}
// Kind → OpenStreetMap tag filter. Cuisines are restaurants/fast food with that cuisine tag.
// Spread-out cities: a wider circle, or most kinds of place come back thin (a few per kind).
const SPREAD = { houston: 2.4, dallas: 2.4, "los angeles": 2, miami: 2, atlanta: 2.2, nashville: 2.2, "las vegas": 2, "san diego": 2, denver: 1.8, austin: 1.8, phoenix: 2.4, queens: 1.6, portland: 1.4, washington: 1.3 }

const KINDS = {
  cafe: `["amenity"="cafe"]`, restaurant: `["amenity"="restaurant"]`, bar: `["amenity"~"^(bar|pub)$"]`, bakery: `["shop"="bakery"]`,
  "fast food": `["amenity"="fast_food"]`, pharmacy: `["amenity"="pharmacy"]`, hairdresser: `["shop"~"^(hairdresser|barber)$"]`,
  supermarket: `["shop"~"^(supermarket|convenience)$"]`, hotel: `["tourism"~"^(hotel|hostel)$"]`, museum: `["tourism"~"^(museum|gallery)$"]`,
  gym: `["leisure"="fitness_centre"]`, cinema: `["amenity"="cinema"]`, "ice cream": `["amenity"="ice_cream"]`, dentist: `["amenity"="dentist"]`
}
const CUISINES = {
  burger: "burger", pizza: "pizza", sushi: "sushi", taco: "mexican|taco", ramen: "ramen", thai: "thai", indian: "indian", chinese: "chinese",
  italian: "italian", bbq: "bbq|barbecue", bagel: "bagel", donut: "donut", pho: "vietnamese", seafood: "seafood|fish", deli: "deli|sandwich", korean: "korean", breakfast: "breakfast|brunch", steak: "steak_house|steak", vegan: null
}

async function overpass(filter, lat, lon, radius) {
  const around = `(around:${radius},${lat},${lon})`
  const q = `[out:json][timeout:25];(nwr${filter}${around};);out center 80;`
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", headers: HEADERS, body: `data=${encodeURIComponent(q)}`, signal: AbortSignal.timeout(40000) }).catch(() => null)
    if (r?.ok) { const d = await r.json().catch(() => null); if (Array.isArray(d?.elements)) return d.elements }
    await new Promise(res => setTimeout(res, 15000 * (attempt + 1))) // busy or rate-limited: wait and try again
  }
  return []
}

function features(t) {
  const yes = v => v === "yes" || v === "only" || v === "designated"
  const out = []
  if (yes(t["diet:vegan"])) out.push("vegan")
  if (yes(t["diet:vegetarian"]) || yes(t["diet:vegan"])) out.push("vegetarian")
  if (yes(t["diet:gluten_free"])) out.push("gluten_free")
  if (yes(t.wheelchair)) out.push("wheelchair")
  if (yes(t.outdoor_seating)) out.push("outdoor_seating")
  if (["wlan", "yes", "wifi"].includes(t.internet_access || "")) out.push("wifi")
  if (yes(t.kids_area) || yes(t.changing_table) || yes(t.highchair)) out.push("kids")
  if (yes(t.dog)) out.push("dogs")
  if (yes(t.takeaway)) out.push("takeaway")
  if (yes(t.delivery)) out.push("delivery")
  if (yes(t.reservation) || t.reservation === "recommended") out.push("reservations")
  return out
}

function place(e, city) {
  const t = e.tags || {}
  return {
    name: t.name, type: String(t.amenity || t.shop || t.tourism || t.leisure || "").replace(/_/g, " "),
    address: [[t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" "), t["addr:city"] || city.replace(/\b\w/g, c => c.toUpperCase())].filter(Boolean).join(", "),
    website: t.website || t["contact:website"] || null, phone: t.phone || t["contact:phone"] || null, opening_hours: t.opening_hours || null,
    // What people filter on ("dog friendly", "outdoor seating", "wifi"…), from OpenStreetMap's tags.
    features: features(t),
    map: `https://www.openstreetmap.org/${e.type}/${e.id}`, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, chain: !!(t.brand || t["brand:wikidata"])
  }
}
// Local places before chains, then ones with opening hours and a website; 12 per kind.
const best = list => list.filter(p => p.name && !/^(vacant|disused)/i.test(p.type))
  .sort((a, b) => (a.chain ? 4 : 0) - (b.chain ? 4 : 0) + (b.opening_hours ? 2 : 0) + (b.website ? 1 : 0) - (a.opening_hours ? 2 : 0) - (a.website ? 1 : 0)).slice(0, 12)

const only = (process.env.CITIES_ONLY || "").split(",").map(c => c.trim().toLowerCase()).filter(Boolean)
fs.mkdirSync("data/places", { recursive: true })
for (const [city, [lat, lon]] of Object.entries(CITIES)) {
  if (only.length && !only.includes(city)) continue
  const kinds = {}
  for (const [kind, filter] of Object.entries(KINDS)) {
    kinds[kind] = best((await overpass(filter, lat, lon, Math.round(2500 * (SPREAD[city] || 1)))).map(e => place(e, city)))
    await new Promise(r => setTimeout(r, 2500))
  }
  for (const [cuisine, tag] of Object.entries(CUISINES)) {
    const filter = tag ? `["amenity"~"^(restaurant|fast_food|cafe)$"]["cuisine"~"${tag}",i]` : `["amenity"~"^(restaurant|fast_food|cafe)$"]["diet:vegan"~"^(yes|only)$"]`
    kinds[cuisine] = best((await overpass(filter, lat, lon, Math.round(4000 * (SPREAD[city] || 1)))).map(e => place(e, city)))
    await new Promise(r => setTimeout(r, 2500))
  }
  // One file per city, written as soon as the city is done (a job that runs out of time keeps what it did).
  fs.writeFileSync(`data/places/${city.replace(/\s+/g, "-")}.json`, JSON.stringify({ built: new Date().toISOString(), city, attribution: "© OpenStreetMap contributors, ODbL", kinds }))
  console.log(`${city}: ${Object.values(kinds).reduce((s, l) => s + l.length, 0)} places`)
}
