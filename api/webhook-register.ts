import type { VercelRequest, VercelResponse } from "@vercel/node"
import { keyHash, verifyApiKey } from "../src/utils/limits"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!


export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

  if (req.method === "OPTIONS") return res.status(200).end()

  const authHeader = req.headers["authorization"] as string || ""
  const apiKey = authHeader.replace("Bearer ", "").trim()

  if (!apiKey || !await verifyApiKey(apiKey)) {
    return res.status(401).json({ error: "Invalid API key" })
  }

  if (req.method === "POST") {
    const { domain, url } = req.body
    if (!domain || !url) return res.status(400).json({ error: "Missing domain or url" })

    try { new URL(url) } catch { return res.status(400).json({ error: "Invalid URL" }) }

    const saved = await fetch(`${SUPABASE_URL}/rest/v1/webhooks?on_conflict=api_key,domain`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
      },
      body: JSON.stringify({ api_key: keyHash(apiKey), domain: domain.toLowerCase(), url })
    })
    if (!saved.ok) return res.status(500).json({ error: "Could not save the webhook — try again" })

    return res.status(200).json({ success: true, domain, url, message: `Webhook registered — you'll be pinged when ${domain}'s LAWP changes` })
  }

  if (req.method === "DELETE") {
    const { domain } = req.body
    await fetch(
      `${SUPABASE_URL}/rest/v1/webhooks?api_key=eq.${keyHash(apiKey)}&domain=eq.${encodeURIComponent(domain)}`,
      {
        method: "DELETE",
        headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }
      }
    )
    return res.status(200).json({ success: true })
  }

  return res.status(405).end()
}