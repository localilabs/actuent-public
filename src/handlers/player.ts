import type { VercelRequest, VercelResponse } from "@vercel/node"

// GET /api/player?code=abcd1234 — has the connect game's player made their first search yet? The code
// is random (made in the player's browser) and only counted, never linked to anything else.
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Cache-Control", "no-store")
  const code = String(req.query.code || "")
  if (!/^[a-z0-9]{8}$/.test(code)) return res.status(400).json({ error: "Bad code" })
  const n = await fetch(`${SUPABASE_URL}/rest/v1/rpc/peek_counter`, { method: "POST", headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ k: `player:${code}`, window_seconds: 3600 }), signal: AbortSignal.timeout(3000) }).then(r => r.ok ? r.json() : 0).catch(() => 0)
  return res.status(200).json({ connected: Number(n) > 0, calls: Number(n) || 0 })
}
