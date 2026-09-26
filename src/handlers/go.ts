import type { VercelRequest, VercelResponse } from "@vercel/node"
import crypto from "crypto"
import { linkSignature } from "../utils/links"

// /go?u=<url>&s=<signature>: counts a visit Actuent sent to a site, then redirects there.

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = String(req.query.u || "")
  const given = String(req.query.s || "")
  const expected = linkSignature(url)
  let target: URL | null = null
  try { target = new URL(url) } catch {}
  const valid = target && /^https?:$/.test(target.protocol) && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  if (!valid) return res.status(400).send("This link isn't valid.")
  // Link previews and bots don't count as visits.
  const ua = String(req.headers["user-agent"] || "")
  if (!/bot|crawler|spider|preview|slurp|facebookexternalhit|embed/i.test(ua)) {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/add_link_click`, {
      method: "POST",
      headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_domain: target!.hostname.toLowerCase().replace(/^www\./, "") })
    }).catch(() => {})
  }
  res.setHeader("Cache-Control", "no-store")
  res.setHeader("Referrer-Policy", "no-referrer-when-downgrade")
  return res.redirect(302, target!.toString())
}
