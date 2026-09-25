import type { VercelRequest, VercelResponse } from "@vercel/node"
import { readiness } from "../src/utils/score"
import { ogImage } from "../src/utils/og"

// Badge for READMEs and websites.
//   /badge.svg                     → "Listed on Actuent"
//   /badge.svg?domain=yoursite.com → live agent-readiness score, updated hourly
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

function esc(s: string) { return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)) }

// The Actuent mark as vector, so the badge works where external images are blocked (e.g. GitHub).
const MARK = `<rect x="10" y="10" width="36" height="36" rx="8" fill="#ff8a3d"/><text x="28" y="36" text-anchor="middle" font-family="Georgia,serif" font-size="24" font-weight="700" fill="#fff">A</text>`

function badge(top: string, bottom: string, color: string, width: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="56" role="img" aria-label="${esc(top)} ${esc(bottom)}">
  <rect width="${width}" height="56" rx="8" fill="#0a0a0a" stroke="#2a2a34"/>
  ${MARK}
  <text x="56" y="23" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="10" fill="#a8a8b6">${esc(top)}</text>
  <text x="56" y="41" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="15" font-weight="700" fill="${color}">${esc(bottom)}</text>
</svg>`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.query.op === "og") return ogImage(req, res)
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Content-Type", "image/svg+xml")
  const domain = String(req.query.domain || "").toLowerCase().replace(/^https?:\/\//, "").split("/")[0]

  if (!domain) {
    res.setHeader("Cache-Control", "public, max-age=86400")
    return res.status(200).send(badge("Listed on", "Actuent", "#f5f5f7", 160))
  }

  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400")
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=*&domain=eq.${encodeURIComponent(domain)}`, {
      headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }
    })
    const site = r.ok ? (await r.json())[0] : null
    if (!site) return res.status(200).send(badge("Actuent · agent-readiness", "Not indexed yet", "#a8a8b6", 210))
    const { score, label } = readiness(site)
    const color = score >= 80 ? "#4ade80" : score >= 45 ? "#ff8a3d" : "#f87171"
    return res.status(200).send(badge(`Actuent · ${label}`, `${score}/100`, color, 200))
  } catch {
    return res.status(200).send(badge("Listed on", "Actuent", "#f5f5f7", 160))
  }
}
