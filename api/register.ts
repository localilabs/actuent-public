import type { VercelRequest, VercelResponse } from "@vercel/node"
import { sites } from "../src/data/sites"
import crypto from "crypto"
import { promises as dns } from "dns"
import { fetchNativeSite } from "../src/utils/native"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

async function verifyApiKey(key: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/api_keys?select=id&key=eq.${key}&active=eq.true`,
    {
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    }
  )
  if (!res.ok) return false
  const data = await res.json()
  return Array.isArray(data) && data.length > 0
}

// Proof that the caller controls the domain: a DNS TXT record with this token, or the site serving
// its own /.well-known/lawp.json. Stops anyone registering LAWP for a site they don't own.
function verificationToken(apiKey: string, domain: string): string {
  return crypto.createHash("sha256").update(`${apiKey}:${domain}`).digest("hex").slice(0, 32)
}

async function ownsDomain(apiKey: string, domain: string): Promise<boolean> {
  const expected = `actuent-site-verification=${verificationToken(apiKey, domain)}`
  try {
    const records = await dns.resolveTxt(domain)
    if (records.some(parts => parts.join("") === expected)) return true
  } catch {}
  return !!await fetchNativeSite(domain)
}

async function saveSite(site: any, ownerKey: string): Promise<void> {
  const headers = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates"
  }
  const row = { domain: site.domain, name: site.name, pages: site.pages, actions: site.actions, updated_at: new Date().toISOString() }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?on_conflict=domain`, { method: "POST", headers, body: JSON.stringify({ ...row, owner_key: ownerKey }) })
  // Before lawp_actions.sql has run there's no owner_key column; save without it.
  if (!res.ok) await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?on_conflict=domain`, { method: "POST", headers, body: JSON.stringify(row) })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const authHeader = req.headers["authorization"] as string || ""
  const apiKey = authHeader.replace("Bearer ", "").trim()

  if (!apiKey) {
    return res.status(401).json({ error: "Missing API key. Get one at actuent.ai" })
  }

  const isValid = await verifyApiKey(apiKey)
  if (!isValid) {
    return res.status(401).json({ error: "Invalid or inactive API key" })
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
    const token = verificationToken(apiKey, cleanDomain)
    return res.status(403).json({
      error: `Verify you own ${cleanDomain} before registering it`,
      verify: {
        dns_txt: { host: cleanDomain, type: "TXT", value: `actuent-site-verification=${token}` },
        or_well_known: `Serve your LAWP at https://${cleanDomain}/.well-known/lawp.json`,
        docs: "https://docs.actuent.ai/#sdk"
      }
    })
  }

  const site = { domain: cleanDomain, name, pages, actions }

  sites[cleanDomain] = site
  await saveSite(site, apiKey)

  return res.status(200).json({
    success: true,
    message: `${cleanDomain} is now listed on Actuent`,
    domain: cleanDomain,
    lawp_url: `https://api.actuent.ai/api/search?q=${cleanDomain}`,
    badge: `[![Listed on Actuent](https://api.actuent.ai/badge.svg)](https://actuent.ai)`
  })
}
