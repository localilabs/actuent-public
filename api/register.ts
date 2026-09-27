import type { VercelRequest, VercelResponse } from "@vercel/node"
import { sites } from "../src/data/sites"
import crypto from "crypto"
import { promises as dns } from "dns"
import { discoverLawp } from "../src/utils/discover"
import { keyHash, verifyApiKey } from "../src/utils/limits"
import { sendEmail, welcomeEmail } from "../src/utils/email"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!


// Proof that the caller controls the domain, with a token only they know (it's derived from their
// API key): a DNS TXT record, a <meta name="actuent-site-verification"> tag on the homepage, or an
// "actuent_site_verification" field in the site's own LAWP (at /.well-known/lawp.json or linked,
// LAWP 0.4). Publishing a LAWP alone is not proof: anyone could then claim that site.
function verificationToken(apiKey: string, domain: string): string {
  return crypto.createHash("sha256").update(`${apiKey}:${domain}`).digest("hex").slice(0, 32)
}

type Proof = "dns" | "meta" | "lawp"

async function ownsDomain(apiKey: string, domain: string): Promise<Proof | null> {
  const token = verificationToken(apiKey, domain)
  try {
    const records = await dns.resolveTxt(domain)
    if (records.some(parts => parts.join("") === `actuent-site-verification=${token}`)) return "dns"
  } catch {}
  try {
    const res = await fetch(`https://${domain}/`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Actuent/1.0; +https://docs.actuent.ai/bot)", "Accept": "text/html" }, redirect: "follow", signal: AbortSignal.timeout(6000) })
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

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
      verify: verifyOptions(apiKey, d),
      lawp: row ? { domain: row.domain, name: row.name, pages: row.pages || {}, actions: row.actions || [] } : { domain: d, name: "", pages: { "/": { title: "", content: "" } }, actions: [] }
    })
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
