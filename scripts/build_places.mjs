// Builds data/us_places.json: places (with opening hours) for the biggest US cities and the things
// people ask for most ("cafes in brooklyn", "tacos in austin"), from OpenStreetMap's Overpass API.
// Searches read this file first, so they're instant and don't depend on OpenStreetMap's free servers
// being quick on launch day; the live lookup stays as the fallback for everything else.
// Weekly (.github/workflows/build_places.yml), or: node scripts/build_places.mjs
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
const KINDS = {
  cafe: `["amenity"="cafe"]`, restaurant: `["amenity"="restaurant"]`, bar: `["amenity"~"^(bar|pub)$"]`, bakery: `["shop"="bakery"]`,
  "fast food": `["amenity"="fast_food"]`, pharmacy: `["amenity"="pharmacy"]`, hairdresser: `["shop"~"^(hairdresser|barber)$"]`,
  supermarket: `["shop"~"^(supermarket|convenience)$"]`, hotel: `["tourism"~"^(hotel|hostel)$"]`, museum: `["tourism"~"^(museum|gallery)$"]`,
  gym: `["leisure"="fitness_centre"]`, cinema: `["amenity"="cinema"]`, "ice cream": `["amenity"="ice_cream"]`, dentist: `["amenity"="dentist"]`
}
const CUISINES = {
  burger: "burger", pizza: "pizza", sushi: "sushi", taco: "mexican|taco", ramen: "ramen", thai: "thai", indian: "indian", chinese: "chinese",
  italian: "italian", bbq: "bbq|barbecue", bagel: "bagel", donut: "donut", pho: "vietnamese", seafood: "seafood|fish", deli: "deli|sandwich", korean: "korean", vegan: null
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

function place(e, city) {
  const t = e.tags || {}
  return {
    name: t.name, type: String(t.amenity || t.shop || t.tourism || t.leisure || "").replace(/_/g, " "),
    address: [[t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" "), t["addr:city"] || city.replace(/\b\w/g, c => c.toUpperCase())].filter(Boolean).join(", "),
    website: t.website || t["contact:website"] || null, phone: t.phone || t["contact:phone"] || null, opening_hours: t.opening_hours || null,
    ...(t["diet:vegan"] === "yes" || t["diet:vegan"] === "only" ? { vegan: true } : {}),
    map: `https://www.openstreetmap.org/${e.type}/${e.id}`, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, chain: !!(t.brand || t["brand:wikidata"])
  }
}
// Local places before chains, then ones with opening hours and a website; 12 per kind.
const best = list => list.filter(p => p.name && !/^(vacant|disused)/i.test(p.type))
  .sort((a, b) => (a.chain ? 4 : 0) - (b.chain ? 4 : 0) + (b.opening_hours ? 2 : 0) + (b.website ? 1 : 0) - (a.opening_hours ? 2 : 0) - (a.website ? 1 : 0)).slice(0, 12)

const out = { built: new Date().toISOString(), attribution: "© OpenStreetMap contributors, ODbL", cities: {} }
for (const [city, [lat, lon]] of Object.entries(CITIES)) {
  out.cities[city] = {}
  for (const [kind, filter] of Object.entries(KINDS)) {
    out.cities[city][kind] = best((await overpass(filter, lat, lon, 2500)).map(e => place(e, city)))
    await new Promise(r => setTimeout(r, 2500))
  }
  for (const [cuisine, tag] of Object.entries(CUISINES)) {
    const filter = tag ? `["amenity"~"^(restaurant|fast_food|cafe)$"]["cuisine"~"${tag}",i]` : `["amenity"~"^(restaurant|fast_food|cafe)$"]["diet:vegan"~"^(yes|only)$"]`
    out.cities[city][cuisine] = best((await overpass(filter, lat, lon, 4000)).map(e => place(e, city)))
    await new Promise(r => setTimeout(r, 2500))
  }
  const n = Object.values(out.cities[city]).reduce((s, l) => s + l.length, 0)
  console.log(`${city}: ${n} places`)
}
fs.mkdirSync("data", { recursive: true })
fs.writeFileSync("data/us_places.json", JSON.stringify(out))
console.log(`data/us_places.json: ${(fs.statSync("data/us_places.json").size / 1024).toFixed(0)} KB`)
