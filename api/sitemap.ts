import type { VercelRequest, VercelResponse } from "@vercel/node"
import { slug } from "../src/utils/slug"

// Sitemaps for the public site pages (api.actuent.ai/site/<domain>). Only sites with real content
// (at least one action) are listed; thin entries are noindex anyway.
//   /sitemap.xml              → sitemap index
//   /sitemap-sites-<n>.xml    → up to 10,000 site pages each
//   /sitemap-cities.xml       → city directory pages (cities and categories with 3+ sites)

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }
const BASE = "https://api.actuent.ai"
const PER_FILE = 10000
const FILTER = "actions=neq.%5B%5D"  // (parked/duplicate sites are noindex on their pages)

async function countSites(): Promise<number> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=domain&${FILTER}`, { method: "HEAD", headers: { ...HEADERS, "Prefer": "count=exact", "Range": "0-0" } })
  return Number(r.headers.get("content-range")?.split("/")[1]) || 0
}

function xmlEscape(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;") }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/xml; charset=utf-8")
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400, stale-while-revalidate=86400")
  if (req.query.part === "cities") {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/lawp_city_categories?min_sites=3`, { headers: HEADERS })
    const rows: any[] = r.ok ? await r.json() : []
    const hidden = new Set(["adult", "gambling"])
    const cities = new Set<string>(), urls: string[] = []
    for (const row of rows) {
      if (!row.city || hidden.has(row.category)) continue
      const c = slug(row.city)
      if (!c) continue
      if (!cities.has(c)) { cities.add(c); urls.push(`  <url><loc>${BASE}/site/in/${xmlEscape(c)}</loc><changefreq>weekly</changefreq></url>`) }
      urls.push(`  <url><loc>${BASE}/site/in/${xmlEscape(c)}/${xmlEscape(row.category)}</loc><changefreq>weekly</changefreq></url>`)
    }
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`)
  }

  const part = parseInt(String(req.query.part || "0"))

  if (!part) {
    const files = Math.max(1, Math.ceil((await countSites()) / PER_FILE))
    const today = new Date().toISOString().slice(0, 10)
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${Array.from({ length: files }, (_, i) => `  <sitemap><loc>${BASE}/sitemap-sites-${i + 1}.xml</loc><lastmod>${today}</lastmod></sitemap>`).join("\n")}
  <sitemap><loc>${BASE}/sitemap-cities.xml</loc><lastmod>${today}</lastmod></sitemap>
</sitemapindex>`)
  }

  const urls: string[] = [`  <url><loc>${BASE}/site</loc><changefreq>daily</changefreq></url>`]
  const start = (part - 1) * PER_FILE
  for (let offset = start; offset < start + PER_FILE; offset += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=domain,updated_at&${FILTER}&order=domain.asc&offset=${offset}&limit=1000`, { headers: HEADERS })
    const rows: any[] = r.ok ? await r.json() : []
    for (const row of rows) {
      urls.push(`  <url><loc>${BASE}/site/${xmlEscape(row.domain)}</loc>${row.updated_at ? `<lastmod>${String(row.updated_at).slice(0, 10)}</lastmod>` : ""}</url>`)
    }
    if (rows.length < 1000) break
  }
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`)
}
