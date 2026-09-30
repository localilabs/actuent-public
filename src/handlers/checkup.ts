import type { VercelRequest, VercelResponse } from "@vercel/node"
import { fetchPublic } from "../utils/safe-fetch"
import { USER_AGENT } from "../utils/robots"
import { extractBusiness } from "../utils/business"
import { discoverLawp } from "../utils/discover"
import { rateLimit, ipHash } from "../utils/limits"
import { later } from "../utils/later"

// GET /api/checkup?domain=yoursite.com — a live look at the site as it is right now (not the copy in
// Actuent's index), for the agent-ready checklists (docs.actuent.ai/checklist). Each check says
// what AI agents get and how to fix it. Also asks for a fresh crawl, so the site's Actuent page
// and score catch up within the hour.

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" }
// Assistants that fetch pages while answering someone (blocking them hides the site from answers).
const ASSISTANT_BOTS = ["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User"]

async function get(url: string, ms = 8000): Promise<{ status: number, text: string, type: string } | null> {
  try {
    const r = await fetchPublic(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(ms) })
    if (!r) return null
    return { status: r.status, text: r.ok ? (await r.text()).slice(0, 1_000_000) : "", type: r.headers.get("content-type") || "" }
  } catch { return null }
}

// Bots that robots.txt shuts out of the whole site ("Disallow: /" in their group, or in * with no own group).
export function blockedBots(robots: string, bots: string[]): string[] {
  const groups: { agents: string[], disallowAll: boolean }[] = []
  let current: { agents: string[], disallowAll: boolean } | null = null, lastWasAgent = false
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim()
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!m) continue
    const [key, value] = [m[1].toLowerCase(), m[2].trim()]
    if (key === "user-agent") {
      if (!lastWasAgent || !current) { current = { agents: [], disallowAll: false }; groups.push(current) }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
    } else {
      lastWasAgent = false
      if (current && key === "disallow" && value === "/") current.disallowAll = true
      if (current && key === "allow" && value === "/") current.disallowAll = false
    }
  }
  return bots.filter(bot => {
    const own = groups.find(g => g.agents.includes(bot.toLowerCase()))
    const group = own || groups.find(g => g.agents.includes("*"))
    return !!group?.disallowAll
  })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Cache-Control", "no-store")
  const domain = String(req.query.domain || "").toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/[^a-z0-9.-]/g, "")
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return res.status(400).json({ error: "Add ?domain=yoursite.com" })
  const ip = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim()
  if ((await rateLimit(`checkup:${ipHash(ip)}`, 12)).limited) return res.status(429).json({ error: "Please wait a minute before checking again." })

  const [home, robots, sitemap, llms, lawp, claimed] = await Promise.all([
    get(`https://${domain}/`, 10000),
    get(`https://${domain}/robots.txt`, 5000),
    get(`https://${domain}/sitemap.xml`, 5000),
    get(`https://${domain}/llms.txt`, 5000),
    discoverLawp(domain).catch(() => null),
    fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=owner_key&domain=eq.${encodeURIComponent(domain)}`, { headers: HEADERS, signal: AbortSignal.timeout(4000) }).then(r => r.ok ? r.json() : []).catch(() => [])
  ])
  if (!home || home.status >= 400 || !home.text) return res.status(200).json({ domain, reachable: false, message: `Couldn't load https://${domain}/ just now${home ? ` (status ${home.status})` : ""}. Check the address, or try again in a minute.` })

  const html = home.text
  const business = extractBusiness(html)
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || ""
  const description = /<meta[^>]+name=["']description["'][^>]*content=["'][^"']{20,}/i.test(html) || /<meta[^>]+content=["'][^"']{20,}["'][^>]*name=["']description["']/i.test(html)
  const contact = !!(business?.telephone || business?.email) || /href=["'](tel:|mailto:)/i.test(html)
  const blocked = robots?.status === 200 ? blockedBots(robots.text, ASSISTANT_BOTS) : []
  const sitemapOk = (sitemap?.status === 200 && /<(urlset|sitemapindex)/i.test(sitemap.text)) || /^\s*sitemap:/im.test(robots?.text || "")
  const llmsOk = llms?.status === 200 && !/html/i.test(llms.type) && llms.text.trim().length > 20

  // Opening hours: do the hours in the schema.org data appear on the page people read? When the page
  // shows times and none of the schema's opening or closing times are among them, one is out of date.
  const visible = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
  const norm = (t: string) => { const [h, m] = t.split(/[:.]/); return `${h.padStart(2, "0")}:${m}` }
  const pageTimes = new Set((visible.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g) || []).map(norm))
  const schemaTimes = new Set((business?.opening_hours || []).flatMap(h => [h.opens, h.closes]).filter(Boolean).map(t => norm(String(t))))
  const hoursMismatch = schemaTimes.size > 0 && pageTimes.size >= 2 && ![...schemaTimes].some(t => pageTimes.has(t))

  const checks = [
    { id: "title", label: "Homepage has a title", ok: title.length > 2, points: 5 },
    { id: "description", label: "Homepage has a meta description", ok: description, points: 10 },
    { id: "business", label: "Business details as schema.org data (name, type, address)", ok: !!business?.name || !!business?.type, points: 20 },
    { id: "contact", label: "A phone number or email agents can find", ok: contact, points: 10 },
    { id: "hours", label: "Opening hours as schema.org data (shops and venues)", ok: !!business?.opening_hours?.length, points: 10, optional: !business?.address },
    { id: "hours_match", label: "Opening hours on the page match the schema.org data", ok: !hoursMismatch, points: 5, optional: !schemaTimes.size || pageTimes.size < 2,
      detail: hoursMismatch ? `The data says ${[...schemaTimes].slice(0, 4).join(", ")}; the page shows ${[...pageTimes].slice(0, 4).join(", ")}` : undefined },
    { id: "ai_bots", label: "robots.txt lets AI assistants in", ok: !blocked.length, points: 15, detail: blocked.length ? `Blocked: ${blocked.join(", ")}` : undefined },
    { id: "sitemap", label: "A sitemap (sitemap.xml)", ok: sitemapOk, points: 10 },
    { id: "llms_txt", label: "An llms.txt summary for AI", ok: llmsOk, points: 5, optional: true },
    { id: "claimed", label: "Claimed on Actuent (you control what agents see)", ok: !!claimed?.[0]?.owner_key, points: 10 },
    { id: "lawp", label: "Its own LAWP file (actions agents can run)", ok: !!lawp, points: 5, optional: true, detail: lawp ? `Found via ${lawp.via}` : undefined }
  ]
  const counted = checks.filter(c => !c.optional || c.ok)
  const score = Math.round(100 * counted.filter(c => c.ok).reduce((n, c) => n + c.points, 0) / counted.reduce((n, c) => n + c.points, 0))
  // Remember that this site was checked, with its first score (list_twentyfive.sql), for "recently fixed".
  await later((async () => {
    const [had] = await fetch(`${SUPABASE_URL}/rest/v1/checkups?select=domain&domain=eq.${encodeURIComponent(domain)}`, { headers: HEADERS }).then(r => r.ok ? r.json() : [null]).catch(() => [null])
    await fetch(`${SUPABASE_URL}/rest/v1/checkups?on_conflict=domain`, { method: "POST", headers: { ...HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(had ? { domain, last_checked_at: new Date().toISOString() } : { domain, first_score: score }) }).catch(() => {})
  })())
  // A fresh crawl, so the Actuent page and badge show the fixes too.
  await later(fetch(`${SUPABASE_URL}/rest/v1/rpc/queue_crawl`, { method: "POST", headers: HEADERS, body: JSON.stringify({ d: domain }), signal: AbortSignal.timeout(3000) }))
  return res.status(200).json({ domain, reachable: true, checked_at: new Date().toISOString(), score, checks, page: `https://api.actuent.ai/site/${domain}` })
}
