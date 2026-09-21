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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  if (req.method === "OPTIONS") return res.status(200).end()

  const ip = (req.headers["x-forwarded-for"] as string || "unknown").split(",")[0].trim()

  if (isRateLimited(ip, 20)) {
    return res.status(429).json({
      error: "Rate limit exceeded",
      message: "Free tier allows 20 requests per minute. Get Pro at actuent.ai for 60/min.",
      retry_after_seconds: 60
    })
  }

  const query = req.method === "GET"
    ? req.query.q as string
    : req.body?.query

  if (!query || typeof query !== "string" || query.trim() === "") {
    return res.status(400).json({ error: "Missing query. Use ?q=your+query for GET or {query} in POST body." })
  }

  const results = await searchSites(query.trim())

  return res.status(200).json({
    query,
    count: results.length,
    results
  })
}
