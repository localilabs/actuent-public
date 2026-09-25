import type { VercelRequest, VercelResponse } from "@vercel/node"
import { searchSites } from "../src/utils/search"
import { verifyApiKey, bearerKey, isInternalCall, isRateLimited } from "../src/utils/limits"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

async function trackSearch(query: string, domains: string[], tier: string, apiKey: string | null): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/searches`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, domains, tier, api_key: apiKey })
    })
  } catch {}
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

  if (req.method === "OPTIONS") return res.status(200).end()

  // Tier comes only from a valid API key in Supabase — never from a client-supplied header.
  const apiKey = bearerKey(req.headers["authorization"])
  const tier = await verifyApiKey(apiKey) ? "pro" : "free"
  const maxPerMinute = tier === "pro" ? 60 : 20

  // The MCP server rate limits its own users, so its calls skip this limit.
  if (!isInternalCall(req.headers["x-actuent-internal"])) {
    const ip = (req.headers["x-forwarded-for"] as string || "unknown").split(",")[0].trim()
    const limitKey = tier === "pro" ? `search:key:${apiKey}` : `search:ip:${ip}`
    if (await isRateLimited(limitKey, maxPerMinute)) {
      return res.status(429).json({
        error: "Rate limit exceeded",
        message: tier === "pro" ? "Pro: 60 req/min" : "Free: 20 req/min — upgrade at actuent.ai",
        retry_after_seconds: 60
      })
    }
  }

  const query = req.method === "GET"
    ? req.query.q as string
    : req.body?.query

  if (!query || typeof query !== "string" || query.trim() === "") {
    return res.status(400).json({ error: "Missing query" })
  }

  const results = await searchSites(query.trim(), tier)
  const domains = results.map(r => r.domain)

  // MCP calls are already logged per key by actuent-private, so don't attribute them to the key twice.
  const trackKey = tier === "pro" && !isInternalCall(req.headers["x-actuent-internal"]) ? apiKey : null
  await trackSearch(query.trim(), domains, tier, trackKey)

  return res.status(200).json({ query, count: results.length, results })
}