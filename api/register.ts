import type { VercelRequest, VercelResponse } from "@vercel/node"
import { sites } from "../src/data/sites"

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

async function saveSite(site: any): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates"
    },
    body: JSON.stringify({
      domain: site.domain,
      name: site.name,
      pages: site.pages,
      actions: site.actions,
      updated_at: new Date().toISOString()
    })
  })
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

  const site = { domain, name, pages, actions }

  sites[domain] = site
  await saveSite(site)

  return res.status(200).json({
    success: true,
    message: `${domain} is now listed on Actuent`,
    domain,
    lawp_url: `https://api.actuent.ai/api/search?q=${domain}`,
    badge: `[![Listed on Actuent](https://api.actuent.ai/badge.svg)](https://actuent.ai)`
  })
}
