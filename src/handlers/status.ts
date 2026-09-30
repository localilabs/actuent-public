import type { VercelRequest, VercelResponse } from "@vercel/node"
import { peekCounter } from "../utils/limits"

// Is Actuent busy right now? Counts busy answers from the search API over the last ~10 minutes
// (api/search.ts). The humans search page and the State page show a banner when it is.
const BUSY_THRESHOLD = parseInt(process.env.BUSY_THRESHOLD || "20")

export default async function status(_req: VercelRequest, res: VercelResponse) {
  const count = await peekCounter("busy", 300)
  const busy = count !== null && count >= BUSY_THRESHOLD
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=60")
  return res.status(200).json({
    busy,
    message: busy ? "Lawpy is showing a LOT of people around right now, so some searches may be simpler or slower than usual. Actuent Pro requests jump the queue." : null,
    checked_at: new Date().toISOString()
  })
}
