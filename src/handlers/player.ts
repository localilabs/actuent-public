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
  // The streak: days in a row (up to today or yesterday) with a search through the player's AI.
  const days: any[] = await fetch(`${SUPABASE_URL}/rest/v1/player_days?select=day&code=eq.${code}&order=day.desc&limit=400`, { headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }, signal: AbortSignal.timeout(3000) }).then(r => r.ok ? r.json() : []).catch(() => [])
  let streak = 0
  let expect = new Date(); expect.setUTCHours(0, 0, 0, 0)
  if (days[0] && days[0].day !== expect.toISOString().slice(0, 10)) expect = new Date(expect.getTime() - 86400000)
  for (const d of days) { if (d.day !== expect.toISOString().slice(0, 10)) break; streak++; expect = new Date(expect.getTime() - 86400000) }
  const LEVELS: [number, string][] = [[30, "Lawpy's best friend"], [14, "Internet legend"], [7, "Internet ranger"], [3, "Trail finder"], [1, "Rookie explorer"]]
  const level = LEVELS.find(([min]) => streak >= min)?.[1] || null
  return res.status(200).json({ connected: Number(n) > 0 || days.length > 0, calls: Number(n) || 0, streak, days_total: days.length, level })
}
