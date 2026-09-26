import type { VercelRequest, VercelResponse } from "@vercel/node"
import crypto from "crypto"

// One-click unsubscribe from the weekly score emails (link and List-Unsubscribe header).
// The token is an HMAC of the domain, made by actuent-crawler/score_emails.ts.

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

function token(domain: string): string {
  return crypto.createHmac("sha256", SUPABASE_SERVICE_KEY).update(`score-emails:${domain}`).digest("hex").slice(0, 32)
}

const page = (title: string, text: string) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Actuent</title><meta name="robots" content="noindex"><style>body{background:#0a0a0a;color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:64px 16px;text-align:center}p{color:#c4c4cf}a{color:#ff8a3d}</style></head><body><h1>${title}</h1><p>${text}</p></body></html>`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store")
  const domain = String(req.query.domain || "").toLowerCase()
  const given = String(req.query.token || "")
  const expected = token(domain)
  const valid = domain && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  if (!valid) return res.status(400).send(page("Link not valid", "This unsubscribe link isn't valid. Email <a href=\"mailto:support@localilabs.com\">support@localilabs.com</a> and we'll sort it out."))
  const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?domain=eq.${encodeURIComponent(domain)}`, {
    method: "PATCH",
    headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ score_emails: false })
  })
  if (!r.ok) return res.status(500).send(page("Something went wrong", "Please try again, or email <a href=\"mailto:support@localilabs.com\">support@localilabs.com</a>."))
  return res.status(200).send(page("Unsubscribed", `You won't get weekly score emails for ${domain.replace(/[<>&"]/g, "")} any more.`))
}
