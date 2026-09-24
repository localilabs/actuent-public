import type { VercelRequest, VercelResponse } from "@vercel/node"
import { searchSites } from "../src/utils/search"

const rateLimits = new Map<string, number[]>()
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

function isRateLimited(ip: string, maxPerMinute: number): boolean {
  const now = Date.now()
  const window = now - 60000
  const timestamps = (rateLimits.get(ip) || []).filter(t => t > window)
  if (timestamps.length >= maxPerMinute) return true
  timestamps.push(now)
  rateLimits.set(ip, timestamps)
  return false
}

async function trackSearch(query: string, domains: string[], tier: string): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/searches`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, domains, tier, api_key: null })
    })
  } catch {}
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-actuent-tier")

  if (req.method === "OPTIONS") return res.status(200).end()

  const ip = (req.headers["x-forwarded-for"] as string || "unknown").split(",")[0].trim()
  const tier = (req.headers["x-actuent-tier"] as string) || "free"
  const maxPerMinute = tier === "pro" ? 60 : 20

  if (isRateLimited(ip, maxPerMinute)) {
    return res.status(429).json({
      error: "Rate limit exceeded",
      message: tier === "pro" ? "Pro: 60 req/min" : "Free: 20 req/min — upgrade at actuent.ai",
      retry_after_seconds: 60
    })
  }

  const query = req.method === "GET"
    ? req.query.q as string
    : req.body?.query

  if (!query || typeof query !== "string" || query.trim() === "") {
    return res.status(400).json({ error: "Missing query" })
  }

  const results = await searchSites(query.trim(), tier)
  const domains = results.map(r => r.domain)

  await trackSearch(query.trim(), domains, tier)

  return res.status(200).json({ query, count: results.length, results })
}