import type { VercelRequest, VercelResponse } from "@vercel/node"
import { searchSites } from "../src/utils/search"

const rateLimits = new Map<string, number[]>()

function isRateLimited(ip: string, maxPerMinute: number): boolean {
  const now = Date.now()
  const windowStart = now - 60000
  const timestamps = (rateLimits.get(ip) || []).filter(t => t > windowStart)
  if (timestamps.length >= maxPerMinute) return true
  timestamps.push(now)
  rateLimits.set(ip, timestamps)
  return false
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
      message: tier === "pro" ? "Pro tier: 60 requests per minute" : "Free tier: 20 requests per minute. Upgrade at actuent.ai",
      retry_after_seconds: 60
    })
  }

  const query = req.method === "GET"
    ? req.query.q as string
    : req.body?.query

  if (!query || typeof query !== "string" || query.trim() === "") {
    return res.status(400).json({ error: "Missing query. Use ?q=query or POST {query}" })
  }

  const results = await searchSites(query.trim(), tier)

  return res.status(200).json({ query, count: results.length, results })
}