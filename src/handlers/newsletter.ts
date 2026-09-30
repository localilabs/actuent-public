import type { VercelRequest, VercelResponse } from "@vercel/node"
import crypto from "crypto"
import { sendEmail } from "../utils/email"
import { rateLimit, ipHash } from "../utils/limits"

// The weekly "State of the AI web" email (table newsletter, list_twentyone.sql). Double opt-in:
//   POST /api/newsletter {email}            → a confirmation email; nothing else is sent until confirmed
//   GET  /api/newsletter?confirm=<token>    → subscribed
//   GET  /api/newsletter?unsubscribe=<token>→ unsubscribed (every email has this link)
// The weekly send is in actuent-crawler (weekly_report.ts).

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" }
const BASE = "https://api.actuent.ai"

function page(res: VercelResponse, status: number, title: string, text: string, lawpy: string) {
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.setHeader("Cache-Control", "no-store")
  return res.status(status).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} — Actuent</title><script src="/assets/lawpy.js" defer></script>
<style>body{background:#0a0a0a;color:#f0f0f0;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}a{color:#ff8a3d}p{color:#a8a8b6;max-width:440px}</style></head>
<body><lawpy-mascot state="${lawpy}" scale="6"></lawpy-mascot><h1 style="font-size:24px">${title}</h1><p>${text}</p><p><a href="${BASE}/state/weekly">Read this week's issue →</a></p></body></html>`)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.status(204).end()
  const token = String(req.query.confirm || req.query.unsubscribe || "").replace(/[^a-f0-9]/g, "").slice(0, 48)
  // Email apps' one-click "Unsubscribe" button POSTs to the link (List-Unsubscribe-Post).
  if (token && (req.method === "GET" || (req.method === "POST" && req.query.unsubscribe))) {
    const confirming = !!req.query.confirm
    const r = await fetch(`${SUPABASE_URL}/rest/v1/newsletter?token=eq.${token}`, {
      method: "PATCH", headers: { ...HEADERS, "Prefer": "return=representation" },
      body: JSON.stringify(confirming ? { confirmed_at: new Date().toISOString(), unsubscribed_at: null } : { unsubscribed_at: new Date().toISOString() })
    }).catch(() => null)
    const found = r?.ok ? (await r.json()).length : 0
    if (!found) return page(res, 404, "Link not found", "This link has expired or was already used. You can sign up again on the State of the AI web page.", "think")
    return confirming
      ? page(res, 200, "You're subscribed", "The State of the AI web arrives every Monday: what AI agents searched for, the most agent-ready sites and what changed. Unsubscribe from any issue with one click.", "dance")
      : page(res, 200, "Unsubscribed", "You won't get the weekly email any more. Sorry to see you go!", "wave")
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST {\"email\": \"you@example.com\"}" })

  const ip = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim()
  if ((await rateLimit(`newsletter:${ipHash(ip)}`, 5)).limited) return res.status(429).json({ error: "Please wait a minute and try again." })
  const body = typeof req.body === "object" && req.body ? req.body : {}
  const email = String(body.email || "").trim().toLowerCase().slice(0, 200)
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return res.status(400).json({ error: "That doesn't look like an email address." })
  const newToken = crypto.randomBytes(24).toString("hex")
  // Already confirmed: nothing to do (and the answer doesn't reveal whether the address is on the list).
  const existing = await fetch(`${SUPABASE_URL}/rest/v1/newsletter?select=confirmed_at,unsubscribed_at&email=eq.${encodeURIComponent(email)}`, { headers: HEADERS }).then(r => r.ok ? r.json() : []).catch(() => [])
  const already = existing[0]?.confirmed_at && !existing[0]?.unsubscribed_at
  if (!already) {
    const saved = await fetch(`${SUPABASE_URL}/rest/v1/newsletter?on_conflict=email`, { method: "POST", headers: { ...HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ email, token: newToken, confirmed_at: null, unsubscribed_at: null }) }).catch(() => null)
    if (!saved?.ok) return res.status(503).json({ error: "Sign-ups aren't open yet. Please try again later." })
    await sendEmail(email, "Confirm: the State of the AI web, weekly", `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;line-height:1.6">
<img src="${BASE}/assets/lawpy/lawpy-wave.gif" width="108" height="72" alt="Lawpy, the Actuent mascot" style="display:block;margin:0 0 6px;border:0">
<p>Hi! Someone (hopefully you) asked for Actuent's weekly "State of the AI web" email at this address.</p>
<p><a href="${BASE}/api/newsletter?confirm=${newToken}" style="display:inline-block;background:#ff8a3d;color:#0a0a0a;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Yes, send it to me →</a></p>
<p style="color:#666;font-size:13px">If it wasn't you, ignore this email: nothing more will be sent. Actuent, made by localilabs.</p></div>`)
  }
  return res.status(200).json({ ok: true, message: "Check your inbox for a confirmation link." })
}
