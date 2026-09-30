import type { VercelRequest, VercelResponse } from "@vercel/node"
import { sitemapPaths } from "../utils/sitemap_pages"
import { fetchPublic } from "../utils/safe-fetch"
import { USER_AGENT } from "../utils/robots"
import { rateLimit, ipHash } from "../utils/limits"

// GET /api/sitemap-pages?domain=yoursite.com[&sitemap=https://yoursite.com/sitemap.xml]
// For the LAWP Generator (docs.actuent.ai/generator): the site's main pages from its sitemap
// (pricing, services, booking, contact, about…), each with its title and description, ready to
// become LAWP pages. Browsers can't read other sites' sitemaps themselves (CORS), so this does it.

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim()

async function describe(url: string): Promise<{ title: string, content: string } | null> {
  try {
    const r = await fetchPublic(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(6000) })
    if (!r?.ok || !/html/i.test(r.headers.get("content-type") || "")) return null
    const html = (await r.text()).slice(0, 400_000)
    const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "")
    const meta = (html.match(/<meta[^>]+name=["']description["'][^>]*>/i) || html.match(/<meta[^>]+property=["']og:description["'][^>]*>/i) || [])[0] || ""
    let content = decode((meta.match(/content=["']([^"']*)["']/i) || [])[1] || "")
    if (!content) content = decode(((html.match(/<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || "").replace(/<[^>]+>/g, " "))
    return { title: title.slice(0, 120), content: content.slice(0, 300) }
  } catch { return null }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600")
  const domain = String(req.query.domain || "").toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/[^a-z0-9.-]/g, "")
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return res.status(400).json({ error: "Add ?domain=yoursite.com" })
  let sitemap = String(req.query.sitemap || "")
  try { if (sitemap && new URL(sitemap).hostname.replace(/^www\./, "") !== domain.replace(/^www\./, "")) sitemap = "" } catch { sitemap = "" }
  const ip = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim()
  const limit = await rateLimit(`sitemap-pages:${ipHash(ip)}`, 10)
  if (limit.limited) { res.setHeader("Cache-Control", "no-store"); return res.status(429).json({ error: "Please wait a minute and try again." }) }
  const paths = await sitemapPaths(domain, { maps: sitemap ? [sitemap] : undefined, max: 12 })
  const pages: Record<string, { title: string, content: string }> = {}
  await Promise.all(paths.map(async p => { const d = await describe(`https://${domain}${p}`); if (d && (d.title || d.content)) pages[p] = d }))
  const ordered = Object.fromEntries(paths.filter(p => pages[p]).map(p => [p, pages[p]]))
  return res.status(200).json({ domain, found: Object.keys(ordered).length, pages: ordered,
    ...(paths.length ? {} : { message: "No useful pages found in the sitemap (pricing, services, booking, contact, about…). Check that /sitemap.xml exists or give its address." }) })
}
