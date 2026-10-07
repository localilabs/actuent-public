import "../src/utils/db_guard"
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { sites } from "../src/data/sites"
import crypto from "crypto"
import { promises as dns } from "dns"
import { discoverLawp } from "../src/utils/discover"
import { keyHash, verifyApiKey, hitCounter } from "../src/utils/limits"
import { sendEmail, welcomeEmail } from "../src/utils/email"
import { fetchPublic } from "../src/utils/safe-fetch"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!


// Proof that the caller controls the domain, with a token only they know (it's derived from their
// API key): a DNS TXT record, a <meta name="actuent-site-verification"> tag on the homepage, or an
// "actuent_site_verification" field in the site's own LAWP (at /.well-known/lawp.json or linked,
// LAWP 0.4). Publishing a LAWP alone is not proof: anyone could then claim that site.
function verificationToken(apiKey: string, domain: string): string {
  return crypto.createHash("sha256").update(`${apiKey}:${domain}`).digest("hex").slice(0, 32)
}

type Proof = "dns" | "meta" | "lawp" | "email"

async function ownsDomain(apiKey: string, domain: string): Promise<Proof | null> {
  const token = verificationToken(apiKey, domain)
  // Already claimed by this key (for example with an email link, below): stays proven.
  const [row] = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=owner_key&domain=eq.${encodeURIComponent(domain)}`, { headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` } })
    .then(r => r.ok ? r.json() : []).catch(() => [])
  if (row?.owner_key && row.owner_key === keyHash(apiKey)) return "email"
  try {
    const records = await dns.resolveTxt(domain)
    if (records.some(parts => parts.join("") === `actuent-site-verification=${token}`)) return "dns"
  } catch {}
  try {
    const res = await fetchPublic(`https://${domain}/`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Actuent/1.0; +https://docs.actuent.ai/bot)", "Accept": "text/html" }, signal: AbortSignal.timeout(6000) })
    if (!res) throw new Error("not public")
    // Redirects are fine (e.g. to www.), as long as they stay on the same site.
    const finalHost = new URL(res.url).hostname.replace(/^www\./, "")
    if (res.ok && finalHost === domain.replace(/^www\./, "")) {
      const head = (await res.text()).slice(0, 300_000).split(/<\/head>/i)[0]
      for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
        if (/name\s*=\s*["']actuent-site-verification["']/i.test(tag) && tag.includes(token)) return "meta"
      }
    }
  } catch {}
  const found = await discoverLawp(domain)
  return found?.doc?.actuent_site_verification === token ? "lawp" : null
}

function verifyOptions(apiKey: string, domain: string) {
  const token = verificationToken(apiKey, domain)
  return {
    token,
    dns_txt: { host: domain, type: "TXT", value: `actuent-site-verification=${token}` },
    meta_tag: `<meta name="actuent-site-verification" content="${token}">`,
    lawp_field: { actuent_site_verification: token },
    docs: "https://docs.actuent.ai/guides#claim"
  }
}

async function saveSite(site: any, ownerKey: string): Promise<void> {
  const headers = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates"
  }
  const row = { domain: site.domain, name: site.name, pages: site.pages, actions: site.actions, updated_at: new Date().toISOString() }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?on_conflict=domain`, { method: "POST", headers, body: JSON.stringify({ ...row, owner_key: keyHash(ownerKey) }) })
  // Before lawp_actions.sql has run there's no owner_key column; save without it.
  if (!res.ok) await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?on_conflict=domain`, { method: "POST", headers, body: JSON.stringify(row) })
}


// ----- Claim by email: a link sent to an address on the site's own domain -----
// The addresses certificate authorities accept as proof of a domain (admin@, webmaster@…), plus
// info@, hello@ and contact@ for smaller sites (not the 20,000 best-known, where those inboxes are
// shared by many). Never on email providers or universities, where anyone can have an address.
const ROLE = new Set(["admin", "administrator", "webmaster", "hostmaster", "postmaster"])
const SMALL_SITE_ROLE = new Set(["info", "hello", "contact", "owner", "kontakt", "mail"])
const PROVIDERS = /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|pm|gmx|web|mail|yandex|zoho|fastmail|hey|tutanota|tuta|seznam|libero|orange|free|t-online|qq|163|126|naver|hushmail|inbox|rocketmail)\./i
const SCHOOL = /(\.edu|\.ac\.[a-z]{2}|\.edu\.[a-z]{2}|\.k12\.[a-z.]+)$/i
const CLAIM_SECRET = process.env.ACTUENT_INTERNAL_KEY || ""
const signClaim = (data: string) => crypto.createHmac("sha256", CLAIM_SECRET).update(`claim:${data}`).digest("base64url").slice(0, 32)

async function emailClaimAllowed(domain: string, email: string): Promise<string | null> {
  const m = email.toLowerCase().trim().match(/^([a-z0-9._+-]+)@([a-z0-9.-]+)$/)
  if (!m) return "That isn't an email address."
  const bare = domain.replace(/^www\./, "")
  if (m[2] !== bare) return `The address must be at ${bare} itself (like webmaster@${bare}).`
  if (PROVIDERS.test(bare) || SCHOOL.test(bare)) return `${bare} gives addresses to the public, so email can't prove you own it. Use the tag or DNS record instead.`
  const local = m[1].split("+")[0]
  if (ROLE.has(local)) return null
  if (SMALL_SITE_ROLE.has(local)) {
    const [site] = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=popularity_rank&domain=in.("${bare}","www.${bare}")&limit=1`, { headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` } }).then(r => r.ok ? r.json() : []).catch(() => [])
    if (!site?.popularity_rank || site.popularity_rank > 20000) return null
    return `${bare} is a well-known site, so use admin@ or webmaster@${bare}, or the tag or DNS record.`
  }
  return `Use admin@${bare} or webmaster@${bare} (or info@, hello@ or contact@ for smaller sites), or the tag or DNS record.`
}

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="robots" content="noindex"><style>body{font-family:-apple-system,Segoe UI,sans-serif;background:#0a0a0a;color:#f0f0f0;max-width:520px;margin:12vh auto;padding:0 16px;line-height:1.6}button{background:#ff8a3d;color:#0a0a0a;border:0;border-radius:8px;padding:12px 18px;font-weight:700;font-size:16px;cursor:pointer}a{color:#ff8a3d}</style></head><body>${body}</body></html>`
const escHtml = (v: string) => v.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))

// GET ?claim=…: a page with one button (links in emails get opened by scanners; only the button claims).
// POST ?claim=…: checks the signature and the 24 hours, then the site is claimed by that key.
async function claimLink(req: VercelRequest, res: VercelResponse) {
  const raw = String(req.query.claim || "")
  const [data, sig] = raw.split(".")
  let c: any = null
  try { if (CLAIM_SECRET && data && sig === signClaim(data)) c = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) } catch {}
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.setHeader("Cache-Control", "no-store")
  if (!c?.d || !c?.k || !(Number(c.x) > Date.now())) return res.status(400).send(page("Link expired", `<h2>This link has expired or isn't valid</h2><p>Claim links work for 24 hours. Ask for a new one in <a href="https://analytics.actuent.ai">Actuent Analytics → My sites</a>.</p>`))
  const domain = String(c.d)
  if (req.method !== "POST") return res.status(200).send(page(`Claim ${escHtml(domain)}`, `<h2>Claim ${escHtml(domain)} on Actuent?</h2><p>This makes you the owner of <strong>${escHtml(domain)}</strong> on Actuent: you decide what AI assistants see about it, and get its weekly AI report.</p><form method="post"><button type="submit">Yes, claim ${escHtml(domain)}</button></form><p style="color:#a8a8b6;font-size:13px">Didn't ask for this? Ignore it and nothing happens.</p>`))
  const headers = { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", "Prefer": "return=representation" }
  const patched = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?domain=eq.${encodeURIComponent(domain)}`, { method: "PATCH", headers, body: JSON.stringify({ owner_key: c.k }) }).then(r => r.ok ? r.json() : []).catch(() => [])
  if (!Array.isArray(patched) || !patched.length) {
    await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?on_conflict=domain`, { method: "POST", headers: { ...headers, "Prefer": "resolution=merge-duplicates" }, body: JSON.stringify({ domain, name: domain, pages: { "/": { title: domain, content: "" } }, actions: [], owner_key: c.k, updated_at: new Date().toISOString() }) }).catch(() => null)
  }
  if (c.m) { const mail = welcomeEmail(domain); await sendEmail(String(c.m), mail.subject, mail.html) }
  return res.status(200).send(page(`${escHtml(domain)} is yours`, `<h2>✓ ${escHtml(domain)} is yours on Actuent</h2><p>Open <a href="https://analytics.actuent.ai">Actuent Analytics → My sites</a> to see and edit what AI assistants see about it.</p>`))
}

async function sendClaimEmail(apiKey: string, domain: string, email: string, res: VercelResponse) {
  const problem = await emailClaimAllowed(domain, email)
  if (problem) return res.status(400).json({ error: problem })
  if (!CLAIM_SECRET) return res.status(503).json({ error: "Email claims aren't available right now. Use the tag or DNS record." })
  // At most 3 claim emails per key an hour and one per domain every 10 minutes.
  const perKey = await hitCounter(`claimmail:${keyHash(apiKey)}`, 3600), perDomain = await hitCounter(`claimmail:${domain}`, 600)
  if ((perKey ?? 0) > 3 || (perDomain ?? 0) > 1) return res.status(429).json({ error: "A claim email was sent just now. Check the inbox (and spam), or try again in 10 minutes." })
  const [account] = await fetch(`${SUPABASE_URL}/rest/v1/api_keys?select=email&key_hash=eq.${keyHash(apiKey)}`, { headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` } }).then(r => r.ok ? r.json() : []).catch(() => [])
  const data = Buffer.from(JSON.stringify({ d: domain, k: keyHash(apiKey), x: Date.now() + 24 * 3600000, m: account?.email || null })).toString("base64url")
  const link = `https://api.actuent.ai/api/register?claim=${data}.${signClaim(data)}`
  const ok = await sendEmail(email, `Claim ${domain} on Actuent`, `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;color:#1a1a1a;line-height:1.6"><img src="https://api.actuent.ai/assets/lawpy/lawpy-wave.gif" width="108" height="72" alt="Lawpy" style="display:block;margin:0 0 6px;border:0"><p>Someone${account?.email ? ` (${escHtml(account.email)})` : ""} wants to claim <strong>${escHtml(domain)}</strong> on Actuent, to manage what AI assistants (in ChatGPT, Claude and others) see about it.</p><p>If that's you or someone you trust, press the button. The link works for 24 hours.</p><p><a href="${link}" style="display:inline-block;background:#ff8a3d;color:#0a0a0a;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Claim ${escHtml(domain)} →</a></p><p style="color:#666;font-size:13px">Didn't expect this? Ignore it and nothing happens. Actuent, made by localilabs.</p></div>`)
  return ok ? res.status(200).json({ sent: true, to: email, message: `Sent. Open the email at ${email} and press the button (it works for 24 hours).` })
    : res.status(502).json({ error: "The email couldn't be sent. Try again, or use the tag or DNS record." })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })
  if (req.query.claim) return claimLink(req, res)

  const authHeader = req.headers["authorization"] as string || ""
  const apiKey = authHeader.replace("Bearer ", "").trim()

  if (!apiKey) {
    return res.status(401).json({ error: "Missing API key. Get one at actuent.ai" })
  }

  const isValid = await verifyApiKey(apiKey)
  if (!isValid) {
    return res.status(401).json({ error: "Invalid or inactive API key" })
  }

  // Claim flow (analytics.actuent.ai → My sites): ownership status, the DNS record to add, and
  // what Actuent currently has for the site, so the owner can start editing from it.
  if (req.method === "GET") {
    const d = String(req.query.domain || "").toLowerCase().replace(/^https?:\/\//, "").split("/")[0].trim()
    if (!d.includes(".")) return res.status(400).json({ error: "Enter a domain like yoursite.com" })
    const proof = await ownsDomain(apiKey, d)
    const verified = !!proof
    const current = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=domain,name,pages,actions,owner_key&domain=eq.${encodeURIComponent(d)}`, {
      headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }
    }).then(r => r.ok ? r.json() : []).catch(() => [])
    const row = Array.isArray(current) ? current[0] : null
    return res.status(200).json({
      domain: d,
      verified,
      claimed_by_you: !!row?.owner_key && row.owner_key === keyHash(apiKey),
      ...(proof ? { verified_with: proof } : {}),
      verify: { ...verifyOptions(apiKey, d), email: `admin@ or webmaster@${d.replace(/^www\./, "")} (POST { domain, claim_email })` },
      lawp: row ? { domain: row.domain, name: row.name, pages: row.pages || {}, actions: row.actions || [] } : { domain: d, name: "", pages: { "/": { title: "", content: "" } }, actions: [] }
    })
  }

  // POST { domain, claim_email }: send a one-click claim link to an address on that domain.
  if (req.body?.claim_email) {
    const d = String(req.body.domain || "").toLowerCase().replace(/^https?:\/\//, "").split("/")[0].trim()
    if (!d.includes(".")) return res.status(400).json({ error: "Enter a domain like yoursite.com" })
    return sendClaimEmail(apiKey, d, String(req.body.claim_email), res)
  }

  const { domain, name, pages, actions } = req.body

  if (!domain || !name || !pages || !actions) {
    return res.status(400).json({
      error: "Missing required fields: domain, name, pages, actions"
    })
  }

  if (typeof domain !== "string" || !domain.includes(".")) {
    return res.status(400).json({ error: "Invalid domain" })
  }

  const cleanDomain = domain.toLowerCase().replace(/^https?:\/\//, "").split("/")[0]
  if (!await ownsDomain(apiKey, cleanDomain)) {
    return res.status(403).json({
      error: `Verify you own ${cleanDomain} before registering it: add one of these, then try again`,
      verify: verifyOptions(apiKey, cleanDomain)
    })
  }

  const site = { domain: cleanDomain, name, pages, actions }
  const auth = { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }
  const [before] = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=owner_key&domain=eq.${encodeURIComponent(cleanDomain)}`, { headers: auth })
    .then(r => r.ok ? r.json() : []).catch(() => [])
  const newClaim = before?.owner_key !== keyHash(apiKey)

  sites[cleanDomain] = site
  await saveSite(site, apiKey)

  // Welcome email the first time this key claims the site.
  if (newClaim) {
    const [account] = await fetch(`${SUPABASE_URL}/rest/v1/api_keys?select=email&key_hash=eq.${keyHash(apiKey)}`, { headers: auth })
      .then(r => r.ok ? r.json() : []).catch(() => [])
    if (account?.email) { const mail = welcomeEmail(cleanDomain); await sendEmail(account.email, mail.subject, mail.html) }
  }

  return res.status(200).json({
    success: true,
    message: `${cleanDomain} is now listed on Actuent`,
    domain: cleanDomain,
    lawp_url: `https://api.actuent.ai/api/search?q=${cleanDomain}`,
    badge: `[![Listed on Actuent](https://api.actuent.ai/badge.svg)](https://actuent.ai)`
  })
}
