import type { VercelRequest, VercelResponse } from "@vercel/node"
import { robotsAllows } from "../src/utils/robots"
import { fetchPublic } from "../src/utils/safe-fetch"
import { readiness } from "../src/utils/score"
import { ogImage } from "../src/utils/og"
import { lawpySvg, seasonHat, HAT_HEIGHT } from "../src/utils/lawpy_frames"
import { LOGO_PNG_DATA_URI } from "../src/utils/logo_data"

// Badge for READMEs and websites.
//   /badge.svg                                → "Listed on Actuent"
//   /badge.svg?domain=yoursite.com            → live agent-readiness score, updated hourly
//   /badge.svg?domain=yoursite.com&style=card → a larger card with the score and its checks
//   /badge.json?domain=yoursite.com           → the same data as JSON (used by /badge.js, the embeddable widget)
// Lawpy sits next to the score: dancing at 90+, standing at 50–89, thinking below 50. &lawpy=0 hides him.
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

function esc(s: string) { return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)) }

// The Actuent logo, embedded, so the badge works where external images are blocked (e.g. GitHub).
const MARK = `<image href="${LOGO_PNG_DATA_URI}" x="10" y="10" width="34" height="36"/>`

// Lawpy for a score: [pose, frames per second (0 = still)].
function mood(score: number): [string, number] {
  return score >= 90 ? ["dance", 10] : score >= 50 ? ["idle", 0] : ["think", 0]
}

function badge(top: string, bottom: string, color: string, width: number, lawpy?: [string, number]) {
  if (lawpy) width += 74
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="56" role="img" aria-label="${esc(top)} ${esc(bottom)}">
  <rect width="${width}" height="56" rx="8" fill="#0a0a0a" stroke="#2a2a34"/>
  ${MARK}
  <text x="56" y="23" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="10" fill="#a8a8b6">${esc(top)}</text>
  <text x="56" y="41" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="15" font-weight="700" fill="${color}">${esc(bottom)}</text>
  ${lawpy ? lawpySvg(lawpy[0], width - 64, seasonHat() ? 10 + HAT_HEIGHT * 1.5 : 10, seasonHat() ? 2.5 : 3, lawpy[1]) : ""}
</svg>`
}

function card(domain: string, name: string, score: number, label: string, checks: { label: string, ok: boolean }[], color: string, lawpy?: [string, number]) {
  const W = 340, H = 168, font = "-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"
  const short = (t: string) => t.replace(/ \(.*\)$/, "").replace("Publishes its own LAWP", "Own LAWP file").slice(0, 34)
  const shown = [...checks.filter(c => c.ok), ...checks.filter(c => !c.ok)].slice(0, 4)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="${esc(name)} is ${score}/100 agent-ready on Actuent">
  <rect width="${W}" height="${H}" rx="12" fill="#0a0a0a" stroke="#2a2a34"/>
  ${MARK}
  <text x="56" y="25" font-family="${font}" font-size="10" fill="#a8a8b6">Actuent · agent-readiness</text>
  <text x="56" y="42" font-family="${font}" font-size="14" font-weight="700" fill="#f5f5f7">${esc(name.slice(0, 30))}</text>
  <text x="18" y="100" font-family="Courier New,monospace" font-size="44" font-weight="700" fill="${color}">${score}</text>
  <text x="${score >= 100 ? 104 : score >= 10 ? 76 : 50}" y="100" font-family="${font}" font-size="12" fill="#a8a8b6">/100</text>
  <text x="18" y="122" font-family="${font}" font-size="12" font-weight="700" fill="${color}">${esc(label)}</text>
  ${shown.map((c, i) => `<text x="170" y="${78 + i * 18}" font-family="${font}" font-size="11" fill="${c.ok ? "#4ade80" : "#8e8e9c"}">${c.ok ? "✓" : "○"} ${esc(short(c.label))}</text>`).join("")}
  <text x="18" y="152" font-family="${font}" font-size="10" fill="#8e8e9c">api.actuent.ai/site/${esc(domain.slice(0, 40))}</text>
  ${lawpy ? lawpySvg(lawpy[0], W - 50, 14, 2, lawpy[1]) : ""}
</svg>`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.query.op === "og") return ogImage(req, res)
  res.setHeader("Access-Control-Allow-Origin", "*")
  const json = req.query.format === "json"
  res.setHeader("Content-Type", json ? "application/json; charset=utf-8" : "image/svg+xml")
  const domain = String(req.query.domain || "").toLowerCase().replace(/^https?:\/\//, "").split("/")[0]
  const style = req.query.style === "card" ? "card" : "compact"
  const withLawpy = req.query.lawpy !== "0"

  // /badge.svg?domain=yoursite.com&lawp=1 → "LAWP: valid" while the site's own /.well-known/lawp.json
  // loads and parses (checked live, cached 6 hours), so the badge updates itself when it breaks or is fixed.
  if (req.query.lawp != null && domain) {
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=21600, stale-while-revalidate=86400")
    let state = "not found", color = "#6b6b78", actions = 0
    try {
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) && await robotsAllows(domain, "/.well-known/lawp.json")) {
        const r = await fetchPublic(`https://${domain}/.well-known/lawp.json`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Actuent/1.0; +https://docs.actuent.ai/bot)", "Accept": "application/json" }, signal: AbortSignal.timeout(6000) }, 0)
        if (r?.ok) {
          const d = JSON.parse((await r.text()).slice(0, 2_000_000))
          if (d?.name && Array.isArray(d.actions)) { state = "valid ✓"; color = "#3fb950"; actions = d.actions.length } else { state = "incomplete"; color = "#d29922" }
        }
      }
    } catch { state = "invalid"; color = "#f85149" }
    if (json) return res.status(200).json({ domain, lawp: state.replace(" ✓", ""), actions, spec: "https://github.com/localilabs/lawp" })
    return res.status(200).send(badge("LAWP", actions ? `${state} · ${actions} action${actions === 1 ? "" : "s"}` : state, color, actions ? 200 : 150, withLawpy && actions ? ["dance", 0] : undefined))
  }

  if (json) {
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=21600, stale-while-revalidate=86400")
    if (!domain) return res.status(400).json({ error: "Add ?domain=yoursite.com" })
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=*&domain=eq.${encodeURIComponent(domain)}`, {
        headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }
      })
      const site = r.ok ? (await r.json())[0] : null
      if (!site) return res.status(404).json({ domain, indexed: false, page: `https://api.actuent.ai/site/${domain}` })
      const { score, label, checks } = readiness(site)
      return res.status(200).json({
        domain, indexed: true, name: site.name || domain, score, label, category: site.category || null,
        checks: checks.map(c => ({ label: c.label, ok: c.ok, points: c.points })),
        page: `https://api.actuent.ai/site/${domain}`, updated_at: site.updated_at
      })
    } catch {
      return res.status(500).json({ error: "Could not load the score" })
    }
  }

  if (!domain) {
    res.setHeader("Cache-Control", "public, max-age=86400")
    return res.status(200).send(badge("Listed on", "Actuent", "#f5f5f7", 160, withLawpy ? ["wave", 7] : undefined))
  }

  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=21600, stale-while-revalidate=86400")
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=*&domain=eq.${encodeURIComponent(domain)}`, {
      headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }
    })
    const site = r.ok ? (await r.json())[0] : null
    if (!site) return res.status(200).send(badge("Actuent · agent-readiness", "Not indexed yet", "#a8a8b6", 210))
    const { score, label, checks } = readiness(site)
    const color = score >= 80 ? "#4ade80" : score >= 45 ? "#ff8a3d" : "#f87171"
    const lawpy = withLawpy ? mood(score) : undefined
    if (style === "card") return res.status(200).send(card(domain, site.name || domain, score, label, checks, color, lawpy))
    return res.status(200).send(badge(`Actuent · ${label}`, `${score}/100`, color, 200, lawpy))
  } catch {
    return res.status(200).send(badge("Listed on", "Actuent", "#f5f5f7", 160))
  }
}
