import type { VercelRequest, VercelResponse } from "@vercel/node"
import { changesFeed } from "../src/utils/feeds"
import { searchTrends } from "../src/utils/trends"
import { productMatches, rankProducts } from "../src/utils/product_match"
import { readiness, ScoreBreakdown } from "../src/utils/score"
import { openNow } from "../src/utils/business"
import { CATEGORIES, HIDDEN_CATEGORIES } from "../src/utils/category"
import { compare } from "../src/utils/competitors"
import { slug } from "../src/utils/slug"
import { AI_BOTS, USER_FACING } from "../src/utils/ai_bots"

// Public page for every indexed site: https://api.actuent.ai/site/<domain>
// Server-rendered for search engines. Thin (minimal) entries are marked noindex.
//   /site            → directory of agent-ready sites
//   /site/nike.com   → what AI agents see on nike.com
//   /site/in/copenhagen             → agent-ready businesses in a city, by category
//   /site/in/copenhagen/restaurant  → one category in a city

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }
const BASE = "https://api.actuent.ai"

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))
}

// A database function's rows; null when the function doesn't exist yet (404).
async function rpcRows(fn: string, args: object): Promise<any[] | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...HEADERS, "Content-Type": "application/json" }, body: JSON.stringify(args), signal: AbortSignal.timeout(8000) })
    if (r.status === 404) return null
    const data = r.ok ? await r.json() : []
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

async function rows(path: string): Promise<any[]> {
  try {
    let r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS })
    // Before list_four.sql there's no status column: ask again without that filter.
    if (!r.ok && path.includes("status=is.null")) r = await fetch(`${SUPABASE_URL}/rest/v1/${path.replace(/&?status=is\.null/, "")}`, { headers: HEADERS })
    const data = r.ok ? await r.json() : []
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

const cityName = (v: string) => v.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")

// Cities (as businesses spell them) with their categories and counts, cached for an hour.
let cityCache: { list: { city: string, category: string, sites: number }[], expires: number } | null = null
export async function cityList(): Promise<{ city: string, category: string, sites: number }[]> {
  if (cityCache && cityCache.expires > Date.now()) return cityCache.list
  const list = (await rows("rpc/lawp_city_categories?min_sites=1")).filter(r => r.city && !HIDDEN_CATEGORIES.has(r.category))
  cityCache = { list, expires: Date.now() + 3600_000 }
  return list
}

// /site/in/<city>/whats-on (and .ics): upcoming events in a city that websites publish.
const icsText = (v: unknown) => String(v ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n")
const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
const fold = (line: string) => line.length <= 74 ? line : line.match(/.{1,74}/g)!.join("\r\n ")

async function eventsPage(res: VercelResponse, citySlug: string, format: "page" | "ics") {
  const known = (await cityList()).find(c => slug(c.city) === citySlug)?.city
  const city = known || cityName(citySlug)
  const pattern = encodeURIComponent(city.replace(/[*,()]/g, "").replace(/ /g, "*"))
  const events = await rows(`lawp_events?select=name,url,domain,start_date,end_date,description,venue,price,currency,online&city=ilike.${pattern}&start_date=gte.${encodeURIComponent(new Date(Date.now() - 3 * 3600_000).toISOString())}&order=start_date.asc&limit=300`)
  if (format === "ics") {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//localilabs//Actuent//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsText(`What's on in ${city} (Actuent)`)}`, "X-PUBLISHED-TTL:PT12H"]
    for (const e of events) {
      lines.push("BEGIN:VEVENT", `UID:${icsText(`${e.url}#${e.start_date}`)}@actuent.ai`, `DTSTAMP:${icsDate(new Date().toISOString())}`, `DTSTART:${icsDate(e.start_date)}`,
        ...(e.end_date ? [`DTEND:${icsDate(e.end_date)}`] : []), `SUMMARY:${icsText(e.name)}`, ...(e.venue ? [`LOCATION:${icsText(e.venue)}`] : []),
        `URL:${e.url}`, `DESCRIPTION:${icsText([e.description, e.price != null ? `Price: ${e.price} ${e.currency || ""}` : "", `From ${e.domain}`].filter(Boolean).join("\n"))}`, "END:VEVENT")
    }
    lines.push("END:VCALENDAR")
    res.setHeader("Content-Type", "text/calendar; charset=utf-8")
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600")
    return res.status(200).send(lines.map(fold).join("\r\n") + "\r\n")
  }
  const byDay = new Map<string, any[]>()
  for (const e of events) {
    const day = new Date(e.start_date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
    if (!byDay.has(day)) byDay.set(day, []); byDay.get(day)!.push(e)
  }
  const ics = `${BASE}/site/in/${citySlug}/whats-on.ics`
  const body = `<div class="eyebrow"><a href="${BASE}/site" style="color:inherit;text-decoration:none">Directory</a> · <a href="${BASE}/site/in/${esc(citySlug)}" style="color:inherit;text-decoration:none">${esc(city)}</a></div>
<h1>What's on in ${esc(city)}</h1>
<p class="lead">${events.length ? `${events.length} upcoming events` : "No upcoming events yet"} that venues and organisers publish on their own websites. Subscribe in your calendar: <a href="${ics.replace(/^https/, "webcal")}">add to calendar</a> · <code>${esc(ics)}</code></p>
${[...byDay.entries()].map(([day, list]) => `<h2>${esc(day)}</h2><div class="card list">${list.map(e => `<a href="${esc(e.url)}" rel="nofollow noopener" target="_blank"><span>${esc(e.name)} <span class="muted">${esc([new Date(e.start_date).toISOString().slice(11, 16) + " UTC", e.venue].filter(Boolean).join(" · "))}</span></span><span>${e.price != null ? `<span class="tag">${esc(e.price)} ${esc(e.currency || "")}</span>` : ""}${e.online ? '<span class="tag">Online</span>' : ""}</span></a>`).join("")}</div>`).join("")}`
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800")
  return res.status(events.length ? 200 : 404).send(layout({
    title: `What's on in ${city} — Actuent`, description: `Upcoming events in ${city}, from venues' own websites.`, canonical: `${BASE}/site/in/${citySlug}/whats-on`,
    image: ogImage(`What's on in ${city}`, "Events from venues' own websites", `api.actuent.ai/site/in/${citySlug}`), noindex: events.length < 3, body
  }))
}

// /site/in/<city>[/<category>]: businesses in a city from their own websites' schema.org address.
async function cityPage(res: VercelResponse, citySlug: string, category: string | null, best = false) {
  const known = (await cityList()).find(c => slug(c.city) === citySlug)?.city
  const city = known || cityName(citySlug)
  const pattern = encodeURIComponent(city.replace(/[*,()]/g, "").replace(/ /g, "*"))
  const hidden = [...HIDDEN_CATEGORIES].map(c => `"${c}"`).join(",")
  const filter = category ? `&category=eq.${encodeURIComponent(category)}` : `&category=not.in.(${encodeURIComponent(hidden)})`
  // Through the city index (sites_in_city, list_fifteen.sql); the plain filter below reads the whole
  // table, so it's only a fallback until that function exists.
  let sites = await rpcRows("sites_in_city", { c: city, cat: category })
  if (sites === null) sites = await rows(`lawp_sites?select=domain,name,category,native,actions,business&business->address->>city=ilike.${pattern}${filter}&status=is.null&order=native.desc,updated_at.desc&limit=300`)
  let listed = sites.filter(s => !HIDDEN_CATEGORIES.has(s.category))
  // "Best of" (/site/in/<city>/<category>/best): rating first, then published opening hours and agent-readiness.
  const bestScore = (x: any) => (x.business?.rating?.value ? Number(x.business.rating.value) / Number(x.business.rating.best || 5) : 0.6) * 0.55 + (x.business?.opening_hours?.length ? 0.15 : 0) + readiness(x).score / 100 * 0.3
  if (best) listed = [...listed].sort((a, b) => bestScore(b) - bestScore(a)).slice(0, 20)
  if (!listed.length) {
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=600")
    return res.status(404).send(layout({ title: `${city} — Actuent`, description: `No agent-ready businesses in ${city} yet.`, canonical: `${BASE}/site/in/${citySlug}`, image: ogImage(city, "Agent-ready businesses", "api.actuent.ai"), noindex: true,
      body: `<h1>Nothing in ${esc(city)} yet</h1><p class="lead">Actuent lists businesses here once their websites publish their address. <a href="https://docs.actuent.ai/generator">Make your site agent-ready</a>.</p>` }))
  }
  const byCategory = new Map<string, any[]>()
  for (const s of listed) { const c = s.category || "other"; if (!byCategory.has(c)) byCategory.set(c, []); byCategory.get(c)!.push(s) }
  const label = (best ? "Best " : "") + (category ? (best ? (CATEGORIES[category] || category).toLowerCase() : (CATEGORIES[category] || category)) : "Agent-ready businesses")
  const card = (s: any) => { const r = readiness(s); return `<a href="${BASE}/site/${esc(s.domain)}"><span>${esc(s.name || s.domain)} <span class="muted">${esc([s.business?.address?.street, s.domain].filter(Boolean).join(" · "))}</span></span><span>${s.business?.rating ? `<span class="tag">★ ${esc(s.business.rating.value)}</span>` : ""}<span class="tag${r.score >= 80 ? " hot" : ""}">${r.score}/100</span></span></a>` }
  const sections = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)
    .map(([c, list]) => `${category ? "" : `<h2><a href="${BASE}/site/in/${esc(citySlug)}/${esc(c)}" style="color:inherit;text-decoration:none">${esc(CATEGORIES[c] || "Other")} (${list.length})</a></h2>`}<div class="card list">${list.slice(0, category ? 300 : 12).map(card).join("")}</div>`).join("")
  const bestLink = category && !best && listed.length >= 5 ? ` <a href="${BASE}/site/in/${esc(citySlug)}/${esc(category)}/best">The best ${esc((CATEGORIES[category] || category).toLowerCase())} →</a>` : ""
  const crumbs: Crumb[] = [{ name: "Directory", url: `${BASE}/site` }, { name: city, url: `${BASE}/site/in/${citySlug}` }]
  if (category) crumbs.push({ name: label, url: `${BASE}/site/in/${citySlug}/${category}` })
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      breadcrumbLd(crumbs),
      { "@type": "ItemList", name: `${label} in ${city}`, numberOfItems: listed.length, itemListElement: listed.slice(0, 50).map((s, i) => ({ "@type": "ListItem", position: i + 1, name: s.name || s.domain, url: `${BASE}/site/${s.domain}` })) }
    ]
  }
  const body = `${breadcrumbHtml(crumbs)}
<h1>${esc(label)} in ${esc(city)}</h1>
<p class="lead">${listed.length} ${category ? esc(label.toLowerCase()) : "businesses"} in ${esc(city)} whose websites AI agents can read and act on, with their agent-readiness score. Ask your AI assistant with Actuent connected, or open one to see what agents see. <a href="${BASE}/site/in/${esc(citySlug)}/whats-on">What's on in ${esc(city)} →</a>${bestLink}${best ? ` Ranked by rating, published opening hours and agent-readiness.` : ""}</p>
${sections}`
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800")
  return res.status(200).send(layout({
    title: `${label} in ${city} — Actuent`, description: `${listed.length} ${label.toLowerCase()} in ${city} that AI agents can read and act on.`,
    canonical: `${BASE}/site/in/${citySlug}${category ? `/${category}` : ""}${best ? "/best" : ""}`, image: ogImage(`${label} in ${city}`, "Agent-ready businesses, by Actuent", `api.actuent.ai/site/in/${citySlug}`),
    noindex: listed.length < 3, jsonLd, body
  }))
}

const STYLE = `
:root{--bg:#0a0a0a;--surface:#13131a;--border:#2a2a34;--text:#f5f5f7;--muted:#a8a8b6;--soft:#c4c4cf;--accent:#ff8a3d;--good:#4ade80;--bad:#f87171}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px 16px 72px;line-height:1.5}
main{max-width:900px;margin:0 auto}
a{color:var(--accent)}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:36px}
.top img{height:22px}.top nav a{font-size:13px;margin-left:16px;text-decoration:none}
.eyebrow{color:var(--accent);font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px}
h1{font-size:36px;letter-spacing:-1px;line-height:1.15;margin-bottom:10px}
.lead{color:var(--soft);font-size:17px;margin-bottom:28px;max-width:720px}
h2{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);margin:34px 0 12px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px 20px;margin-bottom:10px}
.score{display:flex;gap:24px;align-items:center;flex-wrap:wrap}
.score .num{font-size:56px;font-weight:800;font-family:'Courier New',monospace;letter-spacing:-2px}
.checks{list-style:none;font-size:14px;color:var(--soft)}.checks li{padding:3px 0}
.ok{color:var(--good)}.no{color:var(--muted)}
.muted{color:var(--muted);font-size:13px}
.tag{display:inline-block;font-size:11px;padding:2px 8px;border-radius:20px;border:1px solid var(--border);color:var(--soft);margin:2px 4px 2px 0}
.tag.hot{background:var(--accent);color:#0a0a0a;border-color:var(--accent);font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.product{display:flex;gap:12px;align-items:center}.product img{width:56px;height:56px;object-fit:cover;border-radius:8px;background:#fff}
.price{font-family:'Courier New',monospace;color:var(--text);font-weight:700}
.cta{border-color:var(--accent)}
.list a{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);text-decoration:none;color:var(--soft)}
code{background:var(--bg);border:1px solid var(--border);padding:1px 6px;border-radius:4px;font-size:12px}
pre{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 14px;overflow-x:auto;font-size:12px;margin-top:8px;max-height:360px}
pre code{border:none;padding:0}
details summary{cursor:pointer;color:var(--accent);font-size:14px;margin-top:10px}
.fix{font-size:14px;color:var(--soft);padding:6px 0;border-bottom:1px solid var(--border)}.fix:last-child{border-bottom:none}.fix b{color:var(--text)}
.stars{color:var(--accent)}
@media(max-width:600px){h1{font-size:28px}.score .num{font-size:44px}}`

// schema.org type for a business: its own schema.org type when it has one ("Dentist"), otherwise the
// OpenStreetMap kind ("hairdresser") mapped to the nearest schema.org type.
const SCHEMA_TYPES: Record<string, string> = {
  restaurant: "Restaurant", "fast food": "FastFoodRestaurant", cafe: "CafeOrCoffeeShop", bar: "BarOrPub", pub: "BarOrPub", "ice cream": "IceCreamShop",
  bakery: "Bakery", hairdresser: "HairSalon", beauty: "BeautySalon", dentist: "Dentist", doctors: "Physician", clinic: "MedicalClinic",
  pharmacy: "Pharmacy", chemist: "Pharmacy", veterinary: "VeterinaryCare", hotel: "Hotel", hostel: "Hostel", "guest house": "BedAndBreakfast",
  supermarket: "GroceryStore", convenience: "ConvenienceStore", clothes: "ClothingStore", shoes: "ShoeStore", books: "BookStore", florist: "Florist",
  jewelry: "JewelryStore", optician: "Optician", furniture: "FurnitureStore", electronics: "ElectronicsStore", bicycle: "BikeStore", hardware: "HardwareStore",
  "mobile phone": "MobilePhoneStore", toys: "ToyStore", pet: "PetStore", "sports": "SportingGoodsStore", "car repair": "AutoRepair", car: "AutoDealer",
  cinema: "MovieTheater", theatre: "PerformingArtsTheater", museum: "Museum", nightclub: "NightClub", library: "Library", "fitness centre": "ExerciseGym",
  gym: "ExerciseGym", "sports centre": "SportsActivityLocation", lawyer: "Attorney", accountant: "AccountingService", "estate agent": "RealEstateAgent",
  travel_agent: "TravelAgency", "travel agency": "TravelAgency", laundry: "DryCleaningOrLaundry", "dry cleaning": "DryCleaningOrLaundry", tattoo: "TattooParlor"
}
function schemaType(b: any): string {
  const t = String(b?.type || "").trim()
  if (/^[A-Z][A-Za-z]+$/.test(t)) return t
  return SCHEMA_TYPES[t.toLowerCase()] || (b ? "LocalBusiness" : "Organization")
}
const SCHEMA_DAYS: Record<string, string> = { Mo: "Monday", Tu: "Tuesday", We: "Wednesday", Th: "Thursday", Fr: "Friday", Sa: "Saturday", Su: "Sunday" }

type Crumb = { name: string, url: string }
function breadcrumbHtml(crumbs: Crumb[]): string {
  return `<nav aria-label="Breadcrumb" class="eyebrow">${crumbs.map((c, i) => i === crumbs.length - 1
    ? `<span aria-current="page">${esc(c.name)}</span>`
    : `<a href="${esc(c.url)}" style="color:inherit;text-decoration:none">${esc(c.name)}</a>`).join(" › ")}</nav>`
}
function breadcrumbLd(crumbs: Crumb[]) {
  return { "@type": "BreadcrumbList", itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })) }
}

function layout(opts: { title: string, description: string, canonical: string, image: string, noindex?: boolean, jsonLd?: object, feed?: string, body: string }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title><meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${esc(opts.canonical)}">${opts.feed ? `<link rel="alternate" type="application/rss+xml" title="Changes" href="${esc(opts.feed)}">` : ""}${opts.noindex ? '<meta name="robots" content="noindex,follow">' : ""}
<meta property="og:type" content="website"><meta property="og:title" content="${esc(opts.title)}"><meta property="og:description" content="${esc(opts.description)}">
<meta property="og:url" content="${esc(opts.canonical)}"><meta property="og:image" content="${esc(opts.image)}"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" href="${BASE}/assets/actuent-logo.png">
<script src="/assets/lawpy.js" defer></script>
${opts.jsonLd ? `<script type="application/ld+json">${JSON.stringify(opts.jsonLd).replace(/</g, "\\u003c")}</script>` : ""}
<style>${STYLE}:focus-visible{outline:2px solid #8b8bff;outline-offset:2px}.skip{position:absolute;left:-999px;top:8px;background:#fff;color:#000;padding:8px 12px;border-radius:6px}.skip:focus{left:8px}</style></head><body><a class="skip" href="#main">Skip to content</a><main id="main">
<div class="top"><a href="https://actuent.ai"><img src="${BASE}/assets/actuent-logo.png" alt="Actuent"></a><nav><a href="${BASE}/site">Directory</a><a href="${BASE}/trends">Trends</a><a href="https://humans.actuent.ai">Search</a><a href="https://docs.actuent.ai">Docs</a></nav></div>
${opts.body}
<p class="muted" style="margin-top:40px">Actuent is a search engine for AI agents, made by <a href="https://localilabs.com">localilabs</a>. Data is generated automatically from public web content and may be incomplete.</p>
</main></body></html>`
}

// /trends and /trends.json: what people searched most this week (src/utils/trends.ts).
async function trendsPage(res: VercelResponse, json: boolean) {
  const [t, [latest]] = await Promise.all([searchTrends(), rows(`weekly_reports?select=week,data&order=week.desc&limit=1`)])
  // Top movers: sites whose agent-readiness score rose most since the week before (weekly_report.ts).
  const movers: { domain: string, from: number, to: number }[] = Array.isArray(latest?.data?.movers) ? latest.data.movers : []
  res.setHeader("Cache-Control", t.available ? "public, max-age=0, s-maxage=3600, stale-while-revalidate=21600" : "no-store")
  if (json) {
    res.setHeader("Content-Type", "application/json; charset=utf-8")
    res.setHeader("Access-Control-Allow-Origin", "*")
    return res.status(200).json({ period: `since ${t.since.slice(0, 10)} (up to 7 days)`, rule: "Plain searches made at least 3 times; no personal details", top: t.top, categories: t.categories, cities: t.cities, top_movers: movers, movers_week: latest?.week || null })
  }
  const link = (q: string) => `<a href="https://humans.actuent.ai/?q=${encodeURIComponent(q)}">${esc(q)}</a>`
  const list = (items: { query: string, searches: number }[]) => `<ol class="checks" style="padding-left:20px">${items.map(x => `<li>${link(x.query)} <span class="muted">· ${x.searches}</span></li>`).join("")}</ol>`
  const cards = (groups: { name: string, searches: number, queries: { query: string, searches: number }[] }[]) => `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">${groups.map(g => `<div class="card"><strong>${esc(g.name)}</strong> <span class="muted">· ${g.searches} searches</span>${list(g.queries)}</div>`).join("")}</div>`
  const empty = !t.top.length
  const body = `<div style="display:flex;align-items:center;gap:18px"><div><h1>Search trends</h1>
<p class="lead">What people and AI agents searched for most on Actuent this week${t.since > new Date(Date.now() - 7 * 86400000).toISOString() ? ` (counting since ${new Date(t.since).toLocaleDateString("en-GB", { day: "numeric", month: "long" })})` : ""}. Only searches made at least 3 times are shown, and never anything personal. Updated hourly · <a href="${BASE}/trends.json">JSON</a></p></div>
<lawpy-mascot state="${empty ? "think" : "talk"}" ${empty ? "" : `loops="3" then="idle"`} scale="4" style="margin-left:auto"></lawpy-mascot></div>
${empty ? `<div class="card"><p>Not enough searches yet this week for trends. Lawpy is counting. Try <a href="https://humans.actuent.ai">a search</a> of your own.</p></div>` : `
<h2>Top searches</h2><div class="card">${list(t.top)}</div>
${t.categories.length ? `<h2>By category</h2>${cards(t.categories.map(c => ({ name: c.label, searches: c.searches, queries: c.queries })))}` : ""}
${t.cities.length ? `<h2>By city</h2>${cards(t.cities.map(c => ({ name: c.city, searches: c.searches, queries: c.queries })))}` : ""}`}
${movers.length ? `<h2>Top movers</h2><p class="muted">Sites whose agent-readiness score rose most in the week to ${esc(latest.week)}.</p><div class="card"><ol class="checks" style="padding-left:20px">${movers.slice(0, 15).map(m => `<li><a href="${BASE}/site/${esc(m.domain)}">${esc(m.domain)}</a> <span class="muted">· ${m.from} → <strong>${m.to}</strong></span></li>`).join("")}</ol></div>` : ""}`
  return res.status(200).send(layout({
    title: "Search trends — Actuent", description: "What people and AI agents searched for most on Actuent this week, by category and city.",
    canonical: `${BASE}/trends`, image: ogImage("Search trends", "What people and AI agents searched for this week", "api.actuent.ai/trends", "talk"), noindex: empty, body
  }))
}

// /status: 30 days of "does search answer" (hourly checks, uptime_checks) and search speed per day.
async function statusPage(res: VercelResponse) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString()
  const [checks, speed] = await Promise.all([
    rows(`uptime_checks?select=*&checked_at=gte.${encodeURIComponent(since)}&order=checked_at.asc&limit=1000`),
    rpcRows("search_speed_daily", { days: 30 })
  ])
  const byDay = new Map<string, { ok: number, total: number }>()
  for (const c of checks) { const d = String(c.checked_at).slice(0, 10); const x = byDay.get(d) || { ok: 0, total: 0 }; x.total++; if (c.ok) x.ok++; byDay.set(d, x) }
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10))
  const up = checks.length ? Math.round(1000 * checks.filter((c: any) => c.ok).length / checks.length) / 10 : null
  const last = checks[checks.length - 1]
  const bar = (d: string) => { const x = byDay.get(d); const color = !x ? "#2a2a34" : x.ok === x.total ? "#4ade80" : x.ok / x.total >= 0.9 ? "#ff8a3d" : "#f87171"; return `<span title="${d}: ${x ? `${x.ok}/${x.total} checks answered` : "no data"}" style="display:inline-block;width:2.6%;height:28px;margin-right:0.6%;border-radius:3px;background:${color}"></span>` }
  const speedRows = (speed || []).slice(-30)
  const body = `<div style="display:flex;align-items:center;gap:18px"><div><h1>Actuent status</h1>
<p class="lead">${last ? (last.ok ? "✓ Search is answering." : "Search didn't answer at the last check.") + ` Last checked ${new Date(last.checked_at).toUTCString().slice(17, 22)} UTC.` : "Checks start within the hour."} Checked every hour.</p></div>
<lawpy-mascot state="${!last || last.ok ? "dance" : "think"}" ${!last || last.ok ? 'loops="2" then="idle"' : ""} scale="4" style="margin-left:auto"></lawpy-mascot></div>
<h2>Search answering, last 30 days${up != null ? ` · ${up}%` : ""}</h2><div class="card"><div>${days.map(bar).join("")}</div><div class="muted" style="margin-top:6px">Each bar is a day: green all checks answered, orange most, red some failed, grey no data.</div></div>
${(() => {
  // The last 24 hours, per part of Actuent (hourly checks): typical and slowest answer times.
  const day = checks.filter((c: any) => Date.parse(c.checked_at) > Date.now() - 86400000)
  const parts: [string, string][] = [["Search", "ms"], ["Site pages", "site_ms"], ["Autocomplete", "autocomplete_ms"], ["Badges", "badge_ms"]]
  const stat = (k: string) => { const v = day.map((c: any) => c[k]).filter((x: any) => typeof x === "number").sort((a: number, b: number) => a - b); return v.length ? { med: v[Math.floor(v.length / 2)], max: v[v.length - 1] } : null }
  const rowsHtml = parts.map(([label, k]) => { const x = stat(k); return x ? `<tr><td>${label}</td><td style="text-align:right">${(x.med / 1000).toFixed(2)} s</td><td style="text-align:right">${(x.max / 1000).toFixed(2)} s</td></tr>` : "" }).join("")
  return rowsHtml ? `<h2>Speed, last 24 hours</h2><div class="card"><table style="width:100%;font-size:13px;border-collapse:collapse"><tr><th style="text-align:left">Part</th><th style="text-align:right">Typical</th><th style="text-align:right">Slowest</th></tr>${rowsHtml}</table><div class="muted" style="margin-top:6px">Measured every hour from outside, like a visitor would.</div></div>` : ""
})()}
${speedRows.length ? `<h2>Search speed per day</h2><div class="card"><table style="width:100%;font-size:13px;border-collapse:collapse"><tr><th style="text-align:left">Day</th><th style="text-align:right">Searches</th><th style="text-align:right">Typical</th><th style="text-align:right">Slowest 5%</th></tr>${speedRows.slice().reverse().slice(0, 14).map((r: any) => `<tr><td>${esc(r.day)}</td><td style="text-align:right">${Number(r.searches).toLocaleString("en")}</td><td style="text-align:right">${(Number(r.median_ms) / 1000).toFixed(1)} s</td><td style="text-align:right">${(Number(r.p95_ms) / 1000).toFixed(1)} s</td></tr>`).join("")}</table></div>` : ""}
<p class="muted">Busy right now? The live answer is <a href="${BASE}/api/status">api.actuent.ai/api/status</a>.</p>`
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=600")
  return res.status(200).send(layout({ title: "Status — Actuent", description: "Is Actuent search answering, and how fast, over the last 30 days.", canonical: `${BASE}/status`, image: ogImage("Actuent status", "Uptime and search speed, last 30 days", "api.actuent.ai/status", "dance"), body }))
}

// /brand/<name>: the brand's official site, the shops that sell it, and its products (cheapest first).
async function brandPage(res: VercelResponse, brandSlug: string) {
  const brand = brandSlug.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/-/g, " ").trim().slice(0, 40)
  if (!brand) return notFound(res, brandSlug)
  const [named, items] = await Promise.all([
    rpcRows("sites_named", { n: brand }),
    fetch(`${SUPABASE_URL}/rest/v1/rpc/search_lawp_items`, { method: "POST", headers: { ...HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ q: brand, max_results: 250 }), signal: AbortSignal.timeout(6000) }).then(r => r.ok ? r.json() : []).catch(() => [])
  ])
  const official = (named || [])[0]
  const products = rankProducts(brand, (Array.isArray(items) ? items : []).filter((p: any) => productMatches(brand, p.name)), 3)
  const shops = new Map<string, { n: number, cheapest: number | null }>()
  for (const p of products) { const x = shops.get(p.domain) || { n: 0, cheapest: null }; x.n++; const e = p.price_eur == null ? null : Number(p.price_eur); if (e != null && (x.cheapest == null || e < x.cheapest)) x.cheapest = e; shops.set(p.domain, x) }
  const title = brand.replace(/\b\w/g, c => c.toUpperCase())
  if (!official && !products.length) {
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600")
    return res.status(404).send(layout({ title: `${title} — Actuent`, description: `Actuent doesn't know ${title} yet.`, canonical: `${BASE}/brand/${brandSlug}`, image: ogImage(title, "Not on Actuent yet", "api.actuent.ai", "think"), noindex: true, body: `<h1>${esc(title)}</h1><p class="lead">Actuent doesn't know this brand yet. <a href="https://humans.actuent.ai/?q=${encodeURIComponent(brand)}">Search for it →</a></p>` }))
  }
  const cheapest = [...products].filter((p: any) => p.price_eur != null).sort((a: any, b: any) => Number(a.price_eur) - Number(b.price_eur)).slice(0, 12)
  const body = `<h1>${esc(title)}</h1>
<p class="lead">${official ? `Official site: <a href="${BASE}/site/${esc(official.domain)}">${esc(official.name || official.domain)}</a> (${esc(official.domain)}).` : ""} ${shops.size ? `${shops.size} shop${shops.size === 1 ? "" : "s"} Actuent knows sell ${esc(title)} products.` : ""}</p>
${shops.size ? `<h2>Where to buy</h2><div class="card"><ul class="checks">${[...shops.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 15).map(([d, x]) => `<li><a href="${BASE}/site/${esc(d)}">${esc(d)}</a> <span class="muted">· ${x.n} product${x.n === 1 ? "" : "s"}${x.cheapest != null ? ` · from €${x.cheapest.toFixed(0)}` : ""}</span></li>`).join("")}</ul></div>` : ""}
${cheapest.length ? `<h2>Products, cheapest first</h2><div class="card"><ul class="checks">${cheapest.map((p: any) => `<li><a href="${esc(p.url)}" rel="nofollow">${esc(p.name)}</a> <span class="muted">· ${esc(p.price)} ${esc(p.currency || "")} · ${esc(p.domain)}</span></li>`).join("")}</ul></div>` : ""}
<p class="muted">Ask an AI assistant with Actuent connected: “cheapest ${esc(brand)} …”.</p>`
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=21600, stale-while-revalidate=86400")
  return res.status(200).send(layout({ title: `${title}: official site, shops and prices — Actuent`, description: `${title}'s official site, the shops that sell it and prices, from Actuent's index.`, canonical: `${BASE}/brand/${brandSlug}`, image: ogImage(title, "Official site, shops and prices", `api.actuent.ai/brand/${brandSlug}`, "talk"), noindex: !official && products.length < 3, body }))
}

// /site/in/<city>/new (and /new.rss): sites Actuent found in the city in the last 7 days.
async function newInCity(res: VercelResponse, citySlug: string, rss: boolean) {
  const known = (await cityList()).find(c => slug(c.city) === citySlug)?.city
  const city = known || cityName(citySlug)
  const since = new Date(Date.now() - 7 * 86400000).toISOString()
  const found = (await rpcRows("new_in_city", { c: city, since, max_results: 60 })) || []
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=21600")
  if (rss) {
    const x = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!))
    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8")
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${x(`New in ${city} — Actuent`)}</title><link>${BASE}/site/in/${citySlug}/new</link><description>${x(`Businesses and places in ${city} Actuent found this week.`)}</description>
${found.map((s: any) => `<item><title>${x(s.name || s.domain)}</title><link>${BASE}/site/${x(s.domain)}</link><guid isPermaLink="false">${x(s.domain)}</guid><pubDate>${new Date(s.first_seen_at).toUTCString()}</pubDate><description>${x([CATEGORIES[s.category] || "", s.business?.address?.street || ""].filter(Boolean).join(" · "))}</description></item>`).join("\n")}
</channel></rss>`)
  }
  const body = `<h1>New in ${esc(city)}</h1>
<p class="lead">Businesses and places in ${esc(city)} that Actuent found in the last 7 days. <a href="${BASE}/site/in/${esc(citySlug)}/new.rss">RSS</a> · <a href="${BASE}/site/in/${esc(citySlug)}">All of ${esc(city)}</a> · <a href="${BASE}/site/in/${esc(citySlug)}/whats-on">What's on</a></p>
${found.length ? `<div class="card"><ul class="checks">${found.map((s: any) => `<li><a href="${BASE}/site/${esc(s.domain)}">${esc(s.name || s.domain)}</a> <span class="muted">· ${esc(CATEGORIES[s.category] || s.category || "")} · ${new Date(s.first_seen_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></li>`).join("")}</ul></div>` : `<div class="card">Nothing new in ${esc(city)} this week yet.</div>`}`
  return res.status(200).send(layout({ title: `New in ${city} this week — Actuent`, description: `Businesses and places in ${city} Actuent found this week.`, canonical: `${BASE}/site/in/${citySlug}/new`, image: ogImage(`New in ${city}`, "Found this week", `api.actuent.ai/site/in/${citySlug}/new`, "wave"), noindex: found.length < 3, body }))
}

// /deals (and /deals.rss): the biggest product price drops this week across the index.
async function dealsPage(res: VercelResponse, rss: boolean) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString()
  const items = await rows(`lawp_items?select=name,url,domain,price,currency,price_eur,previous_price_eur,image,price_changed_at&price_changed_at=gte.${encodeURIComponent(since)}&previous_price_eur=not.is.null&price_eur=not.is.null&available=is.true&limit=2000`)
  const drops = items.map((i: any) => ({ ...i, drop: Math.round(100 * (1 - Number(i.price_eur) / Number(i.previous_price_eur))) }))
    .filter((i: any) => i.drop >= 10 && i.drop <= 90)
  const domains = [...new Set(drops.map((d: any) => d.domain))]
  const hidden = new Set<string>()
  for (let k = 0; k < domains.length; k += 150) {
    const list = encodeURIComponent(domains.slice(k, k + 150).map(d => `"${d}"`).join(","))
    for (const r of await rows(`lawp_sites?select=domain&category=in.(adult,gambling)&domain=in.(${list})`)) hidden.add(r.domain)
  }
  // The biggest drops first; at most three from one shop.
  const perShop = new Map<string, number>()
  const top = drops.filter((d: any) => !hidden.has(d.domain)).sort((a: any, b: any) => b.drop - a.drop)
    .filter((d: any) => { const n = (perShop.get(d.domain) || 0) + 1; perShop.set(d.domain, n); return n <= 3 }).slice(0, 40)
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=21600")
  const decode = (t: string) => String(t).replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  if (rss) {
    const x = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!))
    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8")
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Price drops this week — Actuent</title><link>${BASE}/deals</link><description>The biggest price drops in shops Actuent knows, this week.</description>
${top.map((d: any) => `<item><title>${x(`−${d.drop}%: ${decode(d.name)} (${d.domain})`)}</title><link>${x(d.url)}</link><guid isPermaLink="false">${x(`${d.url}#${d.price_changed_at}`)}</guid><pubDate>${new Date(d.price_changed_at).toUTCString()}</pubDate><description>${x(`Now ${d.price} ${d.currency || ""} (was about €${Number(d.previous_price_eur).toFixed(2)})`)}</description></item>`).join("\n")}
</channel></rss>`)
  }
  const body = `<div style="display:flex;align-items:center;gap:18px"><div><h1>Price drops this week</h1>
<p class="lead">The biggest price drops this week in the shops Actuent checks every day. <a href="${BASE}/deals.rss">RSS</a></p></div>
<lawpy-mascot state="${top.length ? "dance" : "think"}" ${top.length ? 'loops="2" then="idle"' : ""} scale="4" style="margin-left:auto"></lawpy-mascot></div>
${top.length ? `<div class="card"><ul class="checks">${top.map((d: any) => `<li><strong>−${d.drop}%</strong> <a href="${esc(d.url)}" rel="nofollow">${esc(decode(d.name))}</a> <span class="muted">· now ${esc(d.price)} ${esc(d.currency || "")} · ${esc(d.domain)}</span></li>`).join("")}</ul></div>` : `<div class="card">No big price drops this week yet.</div>`}
<p class="muted">Watch a product's price with an AI assistant: ask it to use Actuent's price watch.</p>`
  return res.status(200).send(layout({ title: "Price drops this week — Actuent", description: "The biggest product price drops this week, from shops Actuent checks daily.", canonical: `${BASE}/deals`, image: ogImage("Price drops this week", "From shops Actuent checks daily", "api.actuent.ai/deals", "dance"), noindex: top.length < 3, body }))
}

// /share?q=… — a link to share a search: link previews show a Lawpy card with the search, and people
// who open it land on that search on humans.actuent.ai.
function sharePage(res: VercelResponse, q: string) {
  const query = q.replace(/\s+/g, " ").trim().slice(0, 80)
  const target = `https://humans.actuent.ai/${query ? `?q=${encodeURIComponent(query)}` : ""}`
  const image = ogImage(query || "The internet — for AI", "My AI found this with Actuent. Lawpy takes full credit.", "actuent.ai", "dance")
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400")
  return res.status(200).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(query || "Actuent")} — found with Actuent</title>
<meta name="robots" content="noindex"><meta property="og:title" content="${esc(query ? `“${query}” — found with Actuent` : "Actuent: the internet for AI")}"><meta property="og:description" content="My AI found this with Actuent. Lawpy takes full credit."><meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image"><meta http-equiv="refresh" content="0;url=${esc(target)}"></head>
<body style="background:#0a0a0a;color:#f5f5f7;font-family:sans-serif"><p><a href="${esc(target)}" style="color:#ff8a3d">See the search →</a></p></body></html>`)
}

// /share?city=Copenhagen&when=tonight — a "what's on" card to share: the link preview counts what's
// on ("Tonight in Copenhagen: 12 concerts · 3 comedy shows · 5 kids' events") and opens the search.
const WHEN_HOURS: Record<string, [number, number]> = { tonight: [0, 14], today: [0, 16], tomorrow: [16, 40], "this weekend": [0, 96], "this week": [0, 168] }
const EVENT_KINDS: [string, string, RegExp][] = [
  ["concert", "concerts", /Genre: |\b(concert|koncert|konsert|konzert|live music|tour)\b/i], ["comedy", "comedy shows", /\b(comedy|stand-?up|improv|komik)\b/i],
  ["kids'", "kids' events", /\b(kids|family|storytime|børn|barn)\b/i], ["market", "markets", /\b(market|marked|loppe|flea)\b/i],
  ["theatre show", "theatre shows", /\b(theatre|theater|teater|play)\b/i], ["club night", "club nights", /\b(club night|dj|techno|house music|rave)\b/i]
]
async function shareEventsPage(res: VercelResponse, cityIn: string, whenIn: string) {
  const city = cityIn.replace(/[^\p{L}\p{N} .'-]/gu, "").trim().slice(0, 40)
  const when = WHEN_HOURS[whenIn.toLowerCase()] ? whenIn.toLowerCase() : "tonight"
  const [a, b] = WHEN_HOURS[when]
  const from = new Date(Date.now() + a * 3600_000 - 3 * 3600_000).toISOString(), to = new Date(Date.now() + b * 3600_000).toISOString()
  const rows: any[] = city ? await fetch(`${SUPABASE_URL}/rest/v1/lawp_events?select=name,description&start_date=gte.${encodeURIComponent(from)}&start_date=lte.${encodeURIComponent(to)}&or=(city.ilike.*${encodeURIComponent(city)}*,venue.ilike.*${encodeURIComponent(city)}*)&limit=1000`, { headers: HEADERS, signal: AbortSignal.timeout(6000) }).then(r => r.ok ? r.json() : []).catch(() => []) : []
  const counts = EVENT_KINDS.map(([one, many, re]) => {
    const n = rows.filter(e => re.test(`${e.name} ${e.description || ""}`)).length
    return n ? `${n} ${n === 1 ? one : many}` : ""
  }).filter(Boolean).slice(0, 3)
  const Title = `${when.charAt(0).toUpperCase()}${when.slice(1)} in ${city || "your city"}`
  const subtitle = rows.length ? `${counts.length ? counts.join(" · ") : `${rows.length} events`}. My AI found these with Actuent.` : "My AI checks what's on with Actuent. Lawpy takes full credit."
  const query = `what's on in ${city} ${when}`
  const target = `https://humans.actuent.ai/?q=${encodeURIComponent(query)}`
  const image = ogImage(Title, subtitle, "actuent.ai", "dance")
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=1800")
  return res.status(200).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(Title)} — found with Actuent</title>
<meta name="robots" content="noindex"><meta property="og:title" content="${esc(`${Title}: ${rows.length ? `${rows.length} things on` : "what's on"}`)}"><meta property="og:description" content="${esc(subtitle)}"><meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image"><meta http-equiv="refresh" content="0;url=${esc(target)}"></head>
<body style="background:#0a0a0a;color:#f5f5f7;font-family:sans-serif"><p><a href="${esc(target)}" style="color:#ff8a3d">See what's on →</a></p></body></html>`)
}

// /smarter — "Your AI got smarter this week": what Actuent (and so every AI using it) learned in the
// last 7 days, from the index and the changelog, in Lawpy's voice. Linked from the weekly email.
async function smarterPage(res: VercelResponse) {
  const week = encodeURIComponent(new Date(Date.now() - 7 * 86400000).toISOString())
  const now = encodeURIComponent(new Date().toISOString())
  const count = async (path: string) => { try { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: "HEAD", headers: { ...HEADERS, "Prefer": "count=exact", "Range": "0-0" }, signal: AbortSignal.timeout(8000) }); return Number(r.headers.get("content-range")?.split("/")[1] || 0) } catch { return 0 } }
  const [newSites, events, priceChanges, products, feed] = await Promise.all([
    count(`lawp_sites?select=domain&first_seen_at=gte.${week}&status=is.null`),
    count(`lawp_events?select=id&start_date=gte.${now}`),
    count(`lawp_items?select=url&price_changed_at=gte.${week}`),
    count(`lawp_items?select=url`),
    fetch("https://docs.actuent.ai/changelog.xml", { signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.text() : "").catch(() => "")
  ])
  const items = [...feed.matchAll(/<item>[\s\S]*?<title>([^<]+)<\/title>[\s\S]*?<pubDate>([^<]+)<\/pubDate>/g)]
    .filter(m => Date.parse(m[2]) > Date.now() - 7 * 86400000).map(m => m[1].replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')).slice(0, 8)
  const n = (x: number) => x.toLocaleString("en")
  const facts = [
    newSites ? `<li><strong>${n(newSites)}</strong> new websites your AI can read</li>` : "",
    events ? `<li><strong>${n(events)}</strong> upcoming events it knows about</li>` : "",
    products ? `<li><strong>${n(products)}</strong> products with prices${priceChanges ? `, <strong>${n(priceChanges)}</strong> of them changed price this week` : ""}</li>` : ""
  ].join("")
  const body = `<div style="display:flex;align-items:center;gap:18px"><div><h1>Your AI got smarter this week</h1>
<p class="lead">Lawpy has been running all over the internet again. Here's what every AI using Actuent can do now that it couldn't last week.</p></div>
<lawpy-mascot state="dance" loops="3" then="idle" scale="4" style="margin-left:auto"></lawpy-mascot></div>
${facts ? `<h2>New things it knows</h2><div class="card"><ul class="checks">${facts}</ul></div>` : ""}
${items.length ? `<h2>New tricks</h2><div class="card"><ul class="checks">${items.map(t => `<li>${esc(t)}</li>`).join("")}</ul><p class="muted" style="margin-top:8px"><a href="https://docs.actuent.ai/changelog">Everything in the changelog →</a></p></div>` : ""}
<h2>Not connected yet?</h2><div class="card"><p>Give your AI the internet in about a minute: <a href="https://docs.actuent.ai/connect">docs.actuent.ai/connect</a>. Lawpy walks you through it.</p></div>`
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=21600, stale-while-revalidate=86400")
  return res.status(200).send(layout({ title: "Your AI got smarter this week — Actuent", description: "What every AI using Actuent learned this week: new websites, events, prices and tricks.", canonical: `${BASE}/smarter`, image: ogImage("Your AI got smarter this week", "New websites, events, prices and tricks", "api.actuent.ai/smarter", "dance"), body }))
}

// Lawpy next to the score: dancing for 90+, waving for 50–89, thinking below 50 (public/assets/lawpy.js).
function lawpyFor(score: number): string {
  const [state, loops, title] = score >= 90 ? ["dance", 4, "Agent-ready!"] : score >= 50 ? ["wave", 2, "Nearly there"] : ["think", 0, "Room to improve"]
  return `<lawpy-mascot state="${state}"${loops ? ` loops="${loops}" then="idle"` : ""} scale="4" title="${title}" style="margin-left:auto"></lawpy-mascot>`
}

// The current LAWP spec version (github.com/localilabs/lawp).
const LAWP_VERSION = "0.5"

// Sign-up box for the weekly email (src/handlers/newsletter.ts: double opt-in, one-click unsubscribe).
const NEWSLETTER_FORM = `<form class="card" onsubmit="event.preventDefault();var f=this,o=f.querySelector('output');fetch('/api/newsletter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.email.value})}).then(function(r){return r.json()}).then(function(d){o.textContent=d.message||d.error}).catch(function(){o.textContent='Could not reach Actuent. Try again.'})" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><label for="nl-email" style="font-weight:600">Get it by email every Monday</label><input id="nl-email" name="email" type="email" required placeholder="you@example.com" style="flex:1;min-width:180px;background:#17171f;border:1px solid #34343f;color:#f0f0f0;padding:8px 10px;border-radius:7px"><button style="background:#ff8a3d;color:#0a0a0a;border:0;border-radius:7px;padding:8px 14px;font-weight:700;cursor:pointer">Subscribe</button><output class="muted" style="width:100%"></output></form>`

function starterLawp(site: any, domain: string) {
  const actions = ((site.actions || []) as any[]).map(({ endpoint, ...a }) => a)
  if (!actions.some(a => a.id === "contact")) actions.push({
    id: "contact", name: "Contact", description: `Send a message to ${site.name || domain}`, intent: ["contact", "message", "email", "get in touch"],
    input: { type: "object", required: true, fields: [
      { name: "name", type: "string", required: true }, { name: "email", type: "email", required: true }, { name: "message", type: "string", required: true }] }
  })
  return { lawp_version: LAWP_VERSION, domain, name: site.name || domain, language: site.language || "en", pages: site.pages || {}, actions }
}

function starterSchema(site: any, domain: string) {
  return {
    "@context": "https://schema.org", "@type": "LocalBusiness", name: site.name || domain, url: `https://${domain}`,
    telephone: "+00 0000 0000", priceRange: "€€",
    address: { "@type": "PostalAddress", streetAddress: "Street 1", postalCode: "0000", addressLocality: "City", addressCountry: "DK" },
    openingHoursSpecification: [{ "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "09:00", closes: "17:00" }]
  }
}

function improveSection(site: any, domain: string, checks: ScoreBreakdown["checks"]) {
  const missing = checks.filter(c => !c.ok)
  if (!missing.length) return ""
  const gain = missing.reduce((n, c) => n + c.points, 0)
  const json = (v: unknown) => esc(JSON.stringify(v, null, 2))
  return `<h2>How to improve this score</h2><div class="card">
<div class="muted" style="margin-bottom:6px">Up to +${gain} points:</div>
${missing.map(c => `<div class="fix"><b>+${c.points} · ${esc(c.label)}</b><br>${c.fix}</div>`).join("")}
${!site.native ? `<details><summary>Starter lawp.json for ${esc(domain)}</summary><div class="muted" style="margin-top:8px">Made from what Actuent already knows. Edit it, then publish it at <code>https://${esc(domain)}/.well-known/lawp.json</code>. Check it with the <a href="https://docs.actuent.ai/#checker">LAWP Checker</a>, or edit it in the <a href="https://docs.actuent.ai/generator?domain=${esc(domain)}">LAWP Generator</a>.</div><pre><code>${json(starterLawp(site, domain))}</code></pre></details>` : ""}
${!site.business ? `<details><summary>Starter schema.org snippet</summary><div class="muted" style="margin-top:8px">Replace the example values, then paste into your homepage's &lt;head&gt;.</div><pre><code>${esc('<script type="application/ld+json">\n')}${json(starterSchema(site, domain))}${esc("\n</script>")}</code></pre></details>` : ""}
</div>`
}

// "Your site in 5 AI assistants": for each assistant, whether its bots may read the site when someone
// asks about it (answers), whether it may learn from it (training), and what it would find.
const ASSISTANTS: { name: string, answer: string[], training: string | null }[] = [
  { name: "ChatGPT", answer: ["OAI-SearchBot", "ChatGPT-User"], training: "GPTBot" },
  { name: "Claude", answer: ["Claude-SearchBot", "Claude-User"], training: "ClaudeBot" },
  { name: "Perplexity", answer: ["PerplexityBot", "Perplexity-User"], training: null },
  { name: "Google Gemini", answer: [], training: "Google-Extended" },
  { name: "Mistral Le Chat", answer: ["MistralAI-User"], training: null }
]
function assistantsCard(site: any, access: any): string {
  if (!access || access.robots_txt === null) return ""
  const blocked = new Set<string>(access.blocked || [])
  const home: any = Object.values(site.pages || {})[0] || {}
  const summary = String(home.content || "").replace(/\s+/g, " ").slice(0, 150)
  const actions = (site.actions || []).length
  const cell = (ok: boolean | null) => ok == null ? '<span class="muted">—</span>' : ok ? '<span class="ok">✓ yes</span>' : '<span class="no">✕ blocked</span>'
  return `<h2>Your site in 5 AI assistants</h2><div class="card"><table style="width:100%;border-collapse:collapse;font-size:13px">
<tr><th style="text-align:left">Assistant</th><th style="text-align:left">Reads it to answer people</th><th style="text-align:left">Learns from it</th></tr>
${ASSISTANTS.map(a => `<tr><td>${esc(a.name)}</td><td>${a.answer.length ? cell(!a.answer.some(b => blocked.has(b))) : '<span class="muted">via Google Search</span>'}</td><td>${cell(a.training ? !blocked.has(a.training) : null)}</td></tr>`).join("")}
</table>
<div class="muted" style="margin-top:10px">What they find (through Actuent, in ChatGPT and Claude): <strong>${esc(site.name || site.domain)}</strong>${summary ? ` — “${esc(summary)}${String(home.content || "").length > 150 ? "…" : ""}”` : ""}, ${actions} action${actions === 1 ? "" : "s"} they can take.</div></div>`
}

// Which AI crawlers and assistants the site's robots.txt blocks, with a fix.
function aiAccessCard(access: any): string {
  if (!access || access.robots_txt === null) return ""
  const blocked: string[] = access.blocked || []
  if (!blocked.length) return `<h2>AI bot access</h2><div class="card"><span class="ok">✓</span> ${access.robots_txt ? "robots.txt lets AI crawlers and assistants in." : "No robots.txt, so AI crawlers and assistants can visit."}</div>`
  const userFacing = blocked.filter(b => USER_FACING.has(b))
  const fix = (userFacing.length ? userFacing : blocked).map(b => `User-agent: ${b}\nAllow: /`).join("\n\n")
  return `<h2>AI bot access</h2><div class="card">
<div>robots.txt blocks <strong>${blocked.length}</strong> AI bot${blocked.length > 1 ? "s" : ""} from the whole site${access.blocks_everyone ? " (it blocks all bots)" : ""}:</div>
<ul class="checks" style="margin-top:6px">${blocked.map(b => `<li class="no">✕ ${esc(b)} <span class="muted">${esc(AI_BOTS[b] || "")}</span></li>`).join("")}</ul>
${userFacing.length ? `<div class="muted" style="margin-top:8px">${userFacing.length} of these fetch pages when someone asks an AI assistant about you. Blocking them means assistants can't read your site for customers.</div>` : ""}
<details><summary>Let them in (add to robots.txt)</summary><div class="muted" style="margin-top:8px">${userFacing.length ? "These lines allow the search and assistant bots while leaving training bots blocked." : "Add these lines to allow them."} Put them above any <code>User-agent: *</code> group.</div><pre><code>${esc(fix)}</code></pre></details></div>`
}

function ogImage(title: string, subtitle: string, tag: string, lawpy = "wave") {
  return `${BASE}/og?${new URLSearchParams({ v: "2", title, subtitle, tag, lawpy })}`
}

async function topCities(): Promise<string> {
  const totals = new Map<string, number>()
  for (const r of await cityList()) totals.set(r.city, (totals.get(r.city) || 0) + Number(r.sites))
  const top = [...totals.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 24)
  return top.length ? `<h2>By city</h2><div>${top.map(([c, n]) => `<a class="tag" href="${BASE}/site/in/${esc(slug(c))}">${esc(c)} · ${n}</a>`).join(" ")}</div>` : ""
}

async function directory(res: VercelResponse) {
  // Both queries at once: a cold page is as slow as the slower one, not the sum.
  const [sites, cities] = await Promise.all([
    rows("lawp_sites?select=domain,name,native,actions&actions=neq.%5B%5D&status=is.null&order=native.desc,updated_at.desc&limit=120"),
    topCities()
  ])
  const body = `<lawpy-mascot state="wave" loops="2" then="idle" scale="5" style="float:right"></lawpy-mascot><div class="eyebrow">Directory</div><h1>Agent-ready websites</h1>
<p class="lead">Websites AI agents can understand and act on through Actuent: their pages, and the actions an agent can take for you.</p>
${cities}
<h2>Recently updated</h2>
<div class="card list">${sites.map(s => `<a href="${BASE}/site/${esc(s.domain)}"><span>${esc(s.name || s.domain)} <span class="muted">${esc(s.domain)}</span></span><span>${s.native ? '<span class="tag hot">Native LAWP</span>' : ""}<span class="tag">${(s.actions || []).length} actions</span></span></a>`).join("")}</div>`
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800")
  return res.status(200).send(layout({
    title: "Agent-ready websites — Actuent", description: "Websites AI agents can understand and act on, indexed by Actuent.",
    canonical: `${BASE}/site`, image: ogImage("Agent-ready websites", "Sites AI agents can understand and act on", "api.actuent.ai/site"), body
  }))
}

function notFound(res: VercelResponse, domain: string) {
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=600")
  return res.status(404).send(layout({
    title: `${domain} — not on Actuent yet`, description: `${domain} isn't in the Actuent index yet.`, canonical: `${BASE}/site/${domain}`,
    image: ogImage("Not indexed yet", domain, "api.actuent.ai", "think"), noindex: true,
    body: `<lawpy-mascot state="think" scale="5" style="margin-bottom:12px"></lawpy-mascot><h1>${esc(domain)} isn't on Actuent yet</h1><p class="lead">Search for it on <a href="https://humans.actuent.ai">humans.actuent.ai</a> and Actuent will index it, or <a href="https://docs.actuent.ai/#platforms">publish your own LAWP</a>.</p>`
  }))
}

// Weekly "State of the AI web" posts (actuent-crawler/weekly_report.ts): /state/weekly, one page
// per week, and an RSS feed.
const n = (v: any) => v == null ? "—" : Number(v).toLocaleString("en-GB")
const weekTitle = (w: string) => new Date(w + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
async function weeklyPage(res: VercelResponse, which: string) {
  if (which === "rss") {
    const posts = await rows("weekly_reports?select=week,title,summary,created_at&order=week.desc&limit=30")
    const xml = (v: string) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8")
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800")
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>State of the AI web — Actuent</title><link>${BASE}/state/weekly</link><description>Every Monday: how much of the web AI agents can read and act on.</description><language>en</language>
${posts.map(p => `<item><title>${xml(p.title)}</title><link>${BASE}/state/weekly/${p.week}</link><guid>${BASE}/state/weekly/${p.week}</guid><pubDate>${new Date(p.created_at).toUTCString()}</pubDate><description>${xml(p.summary)}</description></item>`).join("\n")}
</channel></rss>`)
  }
  const crumbs: Crumb[] = [{ name: "State of the AI web", url: `${BASE}/state` }, { name: "Weekly", url: `${BASE}/state/weekly` }]
  if (which === "index") {
    const posts = await rows("weekly_reports?select=week,title,summary&order=week.desc&limit=100")
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800")
    return res.status(200).send(layout({
      title: "State of the AI web, weekly — Actuent", description: "Every Monday: how much of the web AI agents can read and act on, and what changed.",
      canonical: `${BASE}/state/weekly`, image: ogImage("State of the AI web", "Every Monday, from the Actuent index", "api.actuent.ai/state/weekly"),
      jsonLd: { "@context": "https://schema.org", "@graph": [breadcrumbLd(crumbs), { "@type": "Blog", name: "State of the AI web", url: `${BASE}/state/weekly`, publisher: { "@type": "Organization", name: "Actuent", url: "https://actuent.ai" } }] },
      body: `${breadcrumbHtml(crumbs)}<h1>State of the AI web</h1><p class="lead">Every Monday: how much of the web AI agents can read and act on, and what changed. <a href="${BASE}/state/weekly.rss">RSS feed</a> · <a href="${BASE}/state">Live numbers</a></p>${NEWSLETTER_FORM}
${posts.length ? `<div class="card list">${posts.map(p => `<a href="${BASE}/state/weekly/${esc(p.week)}"><span>${esc(p.title)}<div class="muted">${esc(String(p.summary).slice(0, 160))}…</div></span></a>`).join("")}</div>` : `<p class="muted">The first post goes out on Monday.</p>`}`
    }))
  }
  const week = /^\d{4}-\d{2}-\d{2}$/.test(which) ? which : ""
  const [post] = week ? await rows(`weekly_reports?select=*&week=eq.${week}`) : []
  if (!post) {
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=600")
    return res.status(404).send(layout({ title: "Not found — Actuent", description: "No post for that week.", canonical: `${BASE}/state/weekly`, image: ogImage("State of the AI web", "", "api.actuent.ai"), noindex: true, body: `<h1>No post for that week</h1><p class="lead"><a href="${BASE}/state/weekly">All weeks →</a></p>` }))
  }
  const d = post.data || {}
  const [prev, next] = await Promise.all([
    rows(`weekly_reports?select=week&week=lt.${week}&order=week.desc&limit=1`),
    rows(`weekly_reports?select=week&week=gt.${week}&order=week.asc&limit=1`)
  ])
  crumbs.push({ name: weekTitle(week), url: `${BASE}/state/weekly/${week}` })
  const table = (head: string[], list: any[][]) => `<div class="card"><table style="width:100%;border-collapse:collapse"><thead><tr>${head.map((h, i) => `<th scope="col" style="text-align:${i ? "right" : "left"};padding:4px 0" class="muted">${esc(h)}</th>`).join("")}</tr></thead><tbody>${list.map(r => `<tr>${r.map((c, i) => `<td style="text-align:${i ? "right" : "left"};padding:4px 0">${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
  const body = `${breadcrumbHtml(crumbs)}<lawpy-mascot state="talk" loops="3" then="idle" scale="4" style="float:right"></lawpy-mascot><h1>${esc(post.title)}</h1>
<p class="lead">${esc(post.summary)}</p>
<h2>The numbers</h2>
${table(["", "This week"], [
    ["Websites indexed", n(d.sites)], ["Readable by AI agents", `${n(d.readable)} (${d.readable_percent ?? "—"}%)`], ["Publish their own LAWP", n(d.native)],
    ["Block at least one AI bot", d.ai_access_checked ? `${d.blocking_ai_percent ?? "—"}% of ${n(d.ai_access_checked)} checked` : "—"], ["Products with prices", n(d.products)],
    ["Pages", n(d.pages)], ["Visits sent to websites", d.visits_sent != null ? `${n(d.visits_sent)}${d.click_through_percent != null ? ` (${d.click_through_percent}% of searches)` : ""}` : "—"], ["Upcoming events", n(d.upcoming_events)], ["Businesses with an address", n(d.with_business)], ["New sites this week", n(d.new_sites)], ["Agent searches this week", n(d.searches)]
  ])}
${d.categories?.length ? `<h2>Biggest categories</h2>${table(["Category", "Agent-ready sites"], d.categories.map((c: any) => [esc(CATEGORIES[c.category] || c.category), n(c.sites)]))}` : ""}
${d.cities?.length ? `<h2>Cities with the most agent-ready businesses</h2>${table(["City", "Sites"], d.cities.map((c: any) => [`<a href="${BASE}/site/in/${esc(slug(c.city))}">${esc(c.city)}</a>`, n(c.sites)]))}` : ""}
${d.top_queries?.length ? `<h2>What agents searched for</h2>${table(["Search", "Times"], d.top_queries.map((q: any) => [esc(q.query), n(q.searches)]))}` : ""}
${d.top_sites?.length ? `<h2>Sites agents found most</h2>${table(["Site", "Appearances"], d.top_sites.map((s: any) => [`<a href="${BASE}/site/${esc(s.domain)}">${esc(s.domain)}</a>`, n(s.appearances)]))}` : ""}
<p class="muted" style="margin-top:24px">${prev[0] ? `<a href="${BASE}/state/weekly/${esc(prev[0].week)}">← Week of ${esc(weekTitle(prev[0].week))}</a>` : ""}${prev[0] && next[0] ? " · " : ""}${next[0] ? `<a href="${BASE}/state/weekly/${esc(next[0].week)}">Week of ${esc(weekTitle(next[0].week))} →</a>` : ""}</p>
${NEWSLETTER_FORM}
<p class="muted">Figures come straight from the Actuent index; searches are aggregated and only plain words searched at least 3 times are shown. <a href="${BASE}/state/weekly.rss">RSS</a></p>`
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800")
  return res.status(200).send(layout({
    title: `${post.title} — Actuent`, description: String(post.summary).slice(0, 160), canonical: `${BASE}/state/weekly/${week}`,
    image: ogImage("State of the AI web", `${d.readable_percent ?? ""}% of ${n(d.sites)} sites are AI-readable`, `Week of ${weekTitle(week)}`),
    jsonLd: { "@context": "https://schema.org", "@graph": [breadcrumbLd(crumbs), { "@type": "BlogPosting", headline: post.title, description: String(post.summary).slice(0, 300), datePublished: post.created_at, url: `${BASE}/state/weekly/${week}`, author: { "@type": "Organization", name: "Actuent", url: "https://actuent.ai" }, publisher: { "@type": "Organization", name: "Actuent", url: "https://actuent.ai" } }] },
    body
  }))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  if (req.query.weekly) return weeklyPage(res, String(req.query.weekly))
  if (req.query.changes === "rss" && !req.query.domain) return changesFeed(res, null)
  if (req.query.trends) return trendsPage(res, req.query.trends === "json")
  if (req.query.status === "page") return statusPage(res)
  if (req.query.share != null && req.query.city) return shareEventsPage(res, String(req.query.city), String(req.query.when || "tonight"))
  if (req.query.share != null) return sharePage(res, String(req.query.q || ""))
  if (req.query.smarter != null) return smarterPage(res)
  if (req.query.deals) return dealsPage(res, req.query.deals === "rss")
  if (req.query.brand) return brandPage(res, String(req.query.brand))
  if (req.query.city && req.query.new) return newInCity(res, slug(String(req.query.city)), req.query.new === "rss")
  if (req.query.city && req.query.events) {
    res.setHeader("Content-Type", "text/html; charset=utf-8")
    return eventsPage(res, slug(String(req.query.city)), req.query.events === "ics" ? "ics" : "page")
  }
  if (req.query.city) {
    const category = String(req.query.category || "")
    return cityPage(res, slug(String(req.query.city)), category && CATEGORIES[category] ? category : null, req.query.best === "1")
  }
  const domain = String(req.query.domain || "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/[^a-z0-9.-]/g, "")
  if (!domain) return directory(res)
  if (req.query.changes === "rss") return changesFeed(res, domain)

  const [site] = await rows(`lawp_sites?select=*&domain=eq.${encodeURIComponent(domain)}`)
  if (!site) return notFound(res, domain)
  // ?format=lawp: the site's LAWP as a file, ready to publish at /.well-known/lawp.json.
  if (req.query.format === "lawp") {
    res.setHeader("Content-Type", "application/json; charset=utf-8")
    // /lawp/<domain>.json: hosted for sites that can't publish files themselves (Squarespace, Wix,
    // Webflow…); they point to it with <link rel="lawp" href="…"> in their page head.
    if (req.query.hosted) res.setHeader("Access-Control-Allow-Origin", "*")
    else res.setHeader("Content-Disposition", `attachment; filename="lawp.json"`)
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600")
    // A site with its own LAWP gets it back as published (endpoints included); others get a starter.
    const file = site.native ? { lawp_version: LAWP_VERSION, domain, name: site.name || domain, language: site.language || "en", pages: site.pages || {}, actions: site.actions || [] } : starterLawp(site, domain)
    return res.status(200).send(JSON.stringify(file, null, 2))
  }
  // Search-engine bots crawl tens of thousands of these pages: they get the page without the
  // "compared with similar sites" box, the most expensive part to work out (several queries).
  const isBot = /bot|crawler|spider|slurp|facebookexternalhit|preview|fetch/i.test(String(req.headers["user-agent"] || ""))
  const [products, vs, checksLog] = await Promise.all([
    rows(`lawp_items?select=name,url,price,currency,image,available&domain=eq.${encodeURIComponent(domain)}&order=updated_at.desc&limit=12`),
    site.status || isBot ? Promise.resolve(null) : compare(site, rows).catch(() => null),
    site.native ? rows(`lawp_checks?select=action_id,ok&domain=eq.${encodeURIComponent(domain)}&created_at=gte.${encodeURIComponent(new Date(Date.now() - 30 * 86400000).toISOString())}&limit=2000`) : Promise.resolve([])
  ])
  // Endpoint reliability over 30 days, per action (daily checks and LAWP Checker tests).
  const reliability = new Map<string, { ok: number, total: number }>()
  for (const c of checksLog) { const r = reliability.get(c.action_id) || { ok: 0, total: 0 }; r.total++; if (c.ok) r.ok++; reliability.set(c.action_id, r) }

  const { score, label, checks } = readiness(site)
  const pages = Object.entries(site.pages || {}) as [string, any][]
  const actions = (site.actions || []) as any[]
  const home = pages[0]?.[1]
  const name = site.name || domain
  const thin = !actions.length && !site.native || !!site.status
  const city = site.business?.address?.city ? String(site.business.address.city) : null
  const b = site.business
  const scoreColor = score >= 80 ? "var(--good)" : score >= 45 ? "var(--accent)" : "var(--bad)"
  const open = b ? openNow(b.opening_hours, b.address?.country, new Date(), b.special_hours, Number(b.geo?.lon)) : null
  const description = home?.content && !/^Website at /.test(home.content)
    ? `${String(home.content).slice(0, 150)}${String(home.content).length > 150 ? "…" : ""}`
    : `What AI agents see on ${domain}: pages, actions and agent-readiness score.`

  // Directory › City › Category › site: visible breadcrumbs plus BreadcrumbList structured data.
  const shownCategory = site.category && !HIDDEN_CATEGORIES.has(site.category) ? site.category : null
  const crumbs: Crumb[] = [{ name: "Directory", url: `${BASE}/site` }]
  if (city) crumbs.push({ name: city, url: `${BASE}/site/in/${slug(city)}` })
  if (city && shownCategory) crumbs.push({ name: CATEGORIES[shownCategory] || shownCategory, url: `${BASE}/site/in/${slug(city)}/${shownCategory}` })
  crumbs.push({ name: domain, url: `${BASE}/site/${domain}` })
  const body = `${breadcrumbHtml(crumbs)}
${site.status === "parked" ? `<div class="card" style="border-color:var(--bad)">This domain looks parked or for sale, so it's left out of Actuent search.</div>` : ""}${site.status === "duplicate" && site.duplicate_of ? `<div class="card">This domain redirects to <a href="${BASE}/site/${esc(site.duplicate_of)}">${esc(site.duplicate_of)}</a>, which is shown in search instead.</div>` : ""}
<h1>${esc(name)}${open !== null ? ` <span style="font-size:13px;font-weight:700;vertical-align:middle;padding:2px 9px;border-radius:12px;${open ? "background:#12301f;color:#4ade80" : "background:#301414;color:#f87171"}">${open ? "Open now" : "Closed now"}</span>` : ""}</h1>
<p class="lead">${esc(home?.content || `Actuent has indexed ${domain}.`)}</p>

<div class="card score"><div class="num" style="color:${scoreColor}">${score}</div><div><strong>${esc(label)}</strong><div class="muted">Agent-readiness score out of 100</div>
<ul class="checks" style="margin-top:8px">${checks.map(c => `<li class="${c.ok ? "ok" : "no"}">${c.ok ? "✓" : "○"} ${esc(c.label)}</li>`).join("")}</ul></div>${lawpyFor(score)}</div>

${improveSection(site, domain, checks)}

${actions.length ? `<h2>What AI agents can do here</h2>${actions.map(a => `<div class="card"><strong>${esc(a.name || a.id)}</strong>${a.endpoint && site.native ? ' <span class="tag hot">Executable</span>' : ""}${reliability.get(a.id) ? ` <span class="tag" title="Checks in the last 30 days">${Math.round(reliability.get(a.id)!.ok / reliability.get(a.id)!.total * 100)}% reliable · ${reliability.get(a.id)!.total} checks</span>` : ""}${a.url && !(a.endpoint && site.native) ? ` <a class="tag" href="${esc(a.url)}" rel="nofollow noopener" target="_blank">Direct link →</a>` : ""}<div class="muted">${esc(a.description || "")}</div>${(a.intent || []).slice(0, 6).map((t: string) => `<span class="tag">${esc(t)}</span>`).join("")}</div>`).join("")}` : ""}

${b ? `<h2>Business details</h2><div class="card">${b.rating ? `<div><span class="stars">★ ${esc(b.rating.value)}</span>${b.rating.best ? ` / ${esc(b.rating.best)}` : " / 5"}${b.rating.count ? ` <span class="muted">(${esc(b.rating.count)} reviews)</span>` : ""}${b.rating.source && !/schema|microdata/.test(b.rating.source) ? ` <span class="muted">on ${esc(b.rating.source.charAt(0).toUpperCase() + b.rating.source.slice(1))}</span>` : ""}</div>` : ""}${b.address ? `<div>${esc([b.address.street, b.address.postcode, b.address.city, b.address.country].filter(Boolean).join(", "))}</div>` : ""}${b.telephone ? `<div>☎ ${esc(b.telephone)}</div>` : ""}${b.price_range ? `<div class="muted">Price range: ${esc(b.price_range)}</div>` : ""}${open !== null ? `<div class="${open ? "ok" : "no"}">${open ? "Open now" : "Closed now"}</div>` : ""}${(b.opening_hours || []).map((h: any) => `<div class="muted">${esc(h.days.join(", "))}: ${esc(h.opens)}–${esc(h.closes)}</div>`).join("")}${(b.special_hours || []).map((h: any) => `<div class="muted">${esc(h.from === h.to ? h.from : `${h.from} to ${h.to}`)}: ${h.closed ? "closed" : `${esc(h.opens)}–${esc(h.closes)}`}</div>`).join("")}${b.source === "openstreetmap" ? `<div class="muted" style="margin-top:6px;font-size:13px">Details © <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap contributors</a></div>` : ""}</div>` : ""}

${b?.offers?.length ? `<h2>Services &amp; prices</h2><div class="card">${(b.offers as any[]).slice(0, 30).map(o => `<div class="fix" style="display:flex;justify-content:space-between;gap:12px"><span>${esc(o.name)}${o.category ? ` <span class="muted">${esc(o.category)}</span>` : ""}</span><span class="price">${o.price != null ? `${esc(o.price)} ${esc(o.currency || "")}` : ""}</span></div>`).join("")}</div>` : ""}

${pages.length > 1 ? `<h2>Pages</h2>${pages.slice(0, 12).map(([path, p]) => `<div class="card"><strong>${esc(p.title || path)}</strong> <span class="muted">${esc(path)}</span><div class="muted">${esc(String(p.content || "").slice(0, 280))}</div></div>`).join("")}` : ""}

${products.length ? `<h2>Products</h2><div class="grid">${products.map(p => `<a class="card product" href="${esc(p.url)}" rel="nofollow noopener" target="_blank" style="text-decoration:none;color:inherit">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : ""}<div><div>${esc(p.name)}</div><div class="price">${p.price != null ? `${esc(p.price)} ${esc(p.currency || "")}` : ""}</div></div></a>`).join("")}</div>` : ""}

<h2>Search this site</h2><form class="card" onsubmit="event.preventDefault();var f=this,o=f.querySelector('div');o.textContent='Searching…';fetch('/api/site-search?domain=${esc(domain)}&q='+encodeURIComponent(f.q.value)).then(function(r){return r.json()}).then(function(d){o.innerHTML='';if(!d.results||!d.results.length){o.textContent=d.message||d.error;return}d.results.forEach(function(x){var p=document.createElement('p'),a=document.createElement('a');a.href=x.url;a.textContent=x.title;p.appendChild(a);var s=document.createElement('span');s.className='muted';s.textContent=' — '+x.content.slice(0,160);p.appendChild(s);o.appendChild(p)})}).catch(function(){o.textContent='Could not reach Actuent.'})" style="display:flex;flex-wrap:wrap;gap:8px"><input name="q" required placeholder="e.g. returns, opening hours, pricing" aria-label="Search ${esc(name)}'s pages" style="flex:1;min-width:180px;background:#17171f;border:1px solid #34343f;color:#f0f0f0;padding:8px 10px;border-radius:7px"><button style="background:#ff8a3d;color:#0a0a0a;border:0;border-radius:7px;padding:8px 14px;font-weight:700;cursor:pointer">Search</button><div style="width:100%"></div></form>
${assistantsCard(site, site.ai_access)}
${aiAccessCard(site.ai_access)}

${vs ? `<h2>Compared with similar sites</h2><div class="card"><div>#${vs.rank} of ${vs.total} ${esc((CATEGORIES[vs.category] || vs.category).toLowerCase())}${vs.city ? ` in ${esc(vs.city)}` : " on Actuent"}</div>
<div class="list" style="margin-top:8px">${vs.competitors.map(c => `<a href="${BASE}/site/${esc(c.domain)}"><span>${esc(c.name)} <span class="muted">${esc(c.domain)}</span></span><span class="tag${c.score >= 80 ? " hot" : ""}">${c.score}/100</span></a>`).join("")}</div>
${vs.they_have.length ? `<div class="muted" style="margin-top:10px">What they have that ${esc(name)} doesn't: ${vs.they_have.slice(0, 3).map(t => `${esc(t.label.toLowerCase())} (${t.count} of ${vs.competitors.length})`).join(", ")}.</div>` : ""}</div>` : ""}

<h2>For AI agents</h2><div class="card"><div class="muted">Get this site as structured JSON:</div><code>GET ${BASE}/api/search?q=${esc(domain)}</code>
<div style="margin-top:10px"><a class="tag hot" href="${BASE}/site/${esc(domain)}?format=lawp" download="lawp.json">Download lawp.json</a> <span class="muted">${site.native ? "The LAWP this site publishes." : `Ready to publish at https://${esc(domain)}/.well-known/lawp.json, made from what Actuent knows.`}</span></div>
<div class="muted" style="margin-top:8px">Or connect Actuent to ChatGPT or Claude: <code>https://agents.actuent.ai/api/mcp</code></div>
<div class="muted" style="margin-top:8px">Last updated ${site.updated_at ? esc(new Date(site.updated_at).toUTCString().slice(5, 16)) : "recently"}${site.language && site.language !== "en" ? ` · original language: ${esc(site.language)}` : ""}</div></div>

<h2>Is this your site?</h2><div class="card cta"><div>Claim ${esc(domain)} to edit what AI agents see, make your actions executable, and show your score:</div>
<div style="margin-top:10px"><a href="${BASE}/site/${esc(domain)}?format=lawp" download="lawp.json">Download your lawp.json →</a> &nbsp; <a href="https://analytics.actuent.ai/?edit=${esc(domain)}">${site.owner_key ? "Edit what agents see →" : "Claim and edit this site →"}</a> &nbsp; <a href="https://docs.actuent.ai/#platforms">WordPress, Cloudflare &amp; Shopify →</a> &nbsp; <a href="${BASE}/site/${esc(domain)}/changes.rss">Changes feed (RSS) →</a></div>
<div class="muted" style="margin-top:10px">Show your score: <code>&lt;script src="${BASE}/badge.js" data-domain="${esc(domain)}" async&gt;&lt;/script&gt;</code> or the image <code>${BASE}/badge.svg?domain=${esc(domain)}&amp;style=card</code></div></div>`

  const hours = (b?.opening_hours || []).filter((h: any) => Array.isArray(h.days) && h.opens && h.closes)
  const entity = {
    "@type": schemaType(b), "@id": `https://${domain}/#business`, name, url: `https://${domain}`,
    ...(home?.content && !/^Website at /.test(home.content) ? { description: String(home.content).slice(0, 300) } : {}),
    ...(b?.telephone ? { telephone: b.telephone } : {}),
    ...(b?.address ? { address: { "@type": "PostalAddress", ...(b.address.street ? { streetAddress: b.address.street } : {}), ...(b.address.postcode ? { postalCode: b.address.postcode } : {}), ...(b.address.city ? { addressLocality: b.address.city } : {}), ...(b.address.country ? { addressCountry: b.address.country } : {}) } } : {}),
    ...(b?.geo ? { geo: { "@type": "GeoCoordinates", latitude: b.geo.lat, longitude: b.geo.lon } } : {}),
    ...(hours.length ? { openingHoursSpecification: hours.map((h: any) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: h.days.map((d: string) => SCHEMA_DAYS[d] || d), opens: h.opens, closes: h.closes })) } : {}),
    ...(b?.price_range ? { priceRange: b.price_range } : {})
  }
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": `${BASE}/site/${domain}`, name: `${name} — AI agent profile`, url: `${BASE}/site/${domain}`, about: { "@id": entity["@id"] }, breadcrumb: breadcrumbLd(crumbs), ...(site.updated_at ? { dateModified: site.updated_at } : {}) },
      entity
    ]
  }
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800")
  return res.status(200).send(layout({
    title: `${name} (${domain}) — AI agent profile | Actuent`, description, canonical: `${BASE}/site/${domain}`,
    image: ogImage(`${name} is ${score}/100 agent-ready`, `What AI agents see on ${domain}: pages, actions${products.length ? " and products" : ""}`, `api.actuent.ai/site/${domain}`, score >= 90 ? "dance" : score >= 50 ? "wave" : "think"),
    noindex: thin, jsonLd, feed: `${BASE}/site/${domain}/changes.rss`, body
  }))
}
