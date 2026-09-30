import { USER_AGENT } from "./robots"
import { fetchPublic } from "./safe-fetch"

// Finds a site's most useful pages from its sitemap(s). Copy of actuent-crawler/sitemap.ts (used by
// subpages.ts there); here it feeds the LAWP Generator's "Build pages from my sitemap" (/api/sitemap-pages).
// Keep in sync, apart from the `maps` and `max` options.

// Useful page types, matched as whole words in the page's last path segment. Higher = more
// useful to an agent answering questions about the site; at most 2 pages per type are kept.
const USEFUL: { type: string, points: number, words: string[] }[] = [
  { type: "pricing", points: 10, words: ["pricing", "plans", "prices", "price", "rates", "tariffs", "fees", "priser", "preise", "prix", "precios", "prezzi", "prijzen"] },
  { type: "offer", points: 8, words: ["menu", "menus", "services", "service", "treatments", "products", "shop", "store", "catalog", "catalogue", "collections", "menukort", "speisekarte", "carte", "behandlinger", "ydelser", "leistungen"] },
  { type: "booking", points: 8, words: ["book", "booking", "bookings", "reserve", "reservation", "reservations", "appointment", "appointments"] },
  { type: "contact", points: 7, words: ["contact", "locations", "location", "stores", "hours", "opening-hours", "openinghours", "directions", "visit", "kontakt", "aabningstider", "abningstider", "oeffnungszeiten", "horaires"] },
  { type: "policies", points: 7, words: ["shipping", "delivery", "returns", "refunds", "refund", "warranty"] },
  { type: "about", points: 6, words: ["about", "company", "story", "team", "mission"] },
  { type: "help", points: 6, words: ["faq", "faqs", "help", "support", "features"] },
  { type: "events", points: 5, words: ["events", "calendar", "concerts", "classes", "tickets", "programme", "program", "whatson"] },
  { type: "jobs", points: 3, words: ["careers", "jobs"] }
]
const USELESS = /\/(tag|tags|category|author|page\/\d|wp-|cdn-cgi|search|login|signin|cart|checkout|account|privacy|cookie|terms|legal|feed|amp|blog|blogs|news|newsroom|press|changelog|releases|articles|stories|customers|case-studies|integrations|webinars|podcast|guides|gettingreal)(\/|$)|\.(pdf|jpg|jpeg|png|gif|xml|zip)$|\?|\/\d{4}\/\d{2}\//i
async function getText(url: string, ms = 8000): Promise<string | null> {
  try {
    const r = await fetchPublic(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(ms) })
    if (!r) return null
    return r.ok ? (await r.text()).slice(0, 5_000_000) : null
  } catch { return null }
}

// Paths from the site's sitemap(s), ranked by usefulness; [] if there's no sitemap.
export async function sitemapPaths(domain: string, opts: { maps?: string[], max?: number } = {}): Promise<string[]> {
  const MAX_PAGES = opts.max || 8
  let maps = opts.maps?.length ? opts.maps : []
  if (!maps.length) {
    const robots = await getText(`https://${domain}/robots.txt`, 5000)
    maps = [...(robots || "").matchAll(/^\s*sitemap:\s*(\S+)/gim)].map(m => m[1]).slice(0, 3)
  }
  if (!maps.length) maps = [`https://${domain}/sitemap.xml`]
  const locs: string[] = []
  for (const map of maps) {
    const xml = await getText(map)
    if (!xml) continue
    const entries = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1])
    if (/<sitemapindex/i.test(xml)) {
      // Sitemap index: read the child sitemaps most likely to list normal pages.
      const children = entries.sort((a, b) => Number(/page|main|site/i.test(b)) - Number(/page|main|site/i.test(a))).slice(0, 3)
      for (const child of children) {
        const cx = await getText(child)
        if (cx) locs.push(...[...cx.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]))
      }
    } else locs.push(...entries)
    if (locs.length > 5000) break
  }
  const site = domain.replace(/^www\./, "")
  const scored = new Map<string, { score: number, type: string }>()
  for (const loc of locs) {
    let u: URL
    try { u = new URL(loc) } catch { continue }
    const host = u.hostname.replace(/^www\./, "")
    const path = u.pathname.replace(/\/+$/, "") || "/"
    if (host !== site || path === "/" || USELESS.test(u.pathname + u.search)) continue
    const depth = path.split("/").length - 1
    const tokens = path.toLowerCase().split("/").pop()!.split(/[-_.]+/)
    const kind = USEFUL.find(k => k.words.some(w => tokens.includes(w)))
    if (!kind) continue
    const score = kind.points - (depth - 1) * 2
    if (score > 0 && !scored.has(path)) scored.set(path, { score, type: kind.type })
  }
  const perType: Record<string, number> = {}
  return [...scored.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[0].length - b[0].length)
    .filter(([, v]) => (perType[v.type] = (perType[v.type] || 0) + 1) <= 2)
    .slice(0, MAX_PAGES)
    .map(([p]) => p)
}

