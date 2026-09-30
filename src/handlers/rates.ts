import type { VercelRequest, VercelResponse } from "@vercel/node"

// GET /api/rates — euro exchange rates (European Central Bank, via frankfurter.app), for showing
// prices in the visitor's currency on humans.actuent.ai. Cached for 12 hours.
let cached: { rates: Record<string, number>, date: string, until: number } | null = null

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  if (!cached || cached.until < Date.now()) {
    const d = await fetch("https://api.frankfurter.app/latest?from=EUR", { signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.json() : null).catch(() => null)
    if (d?.rates) cached = { rates: { EUR: 1, ...d.rates }, date: d.date, until: Date.now() + 12 * 3600000 }
  }
  if (!cached) { res.setHeader("Cache-Control", "no-store"); return res.status(503).json({ error: "Exchange rates aren't available right now" }) }
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=21600")
  return res.status(200).json({ base: "EUR", date: cached.date, rates: cached.rates, source: "European Central Bank (frankfurter.app)" })
}
