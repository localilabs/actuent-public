import type { VercelRequest, VercelResponse } from "@vercel/node"
import stats from "../src/handlers/stats"
import diff from "../src/handlers/diff"
import state from "../src/handlers/state"
import leaderboard from "../src/handlers/leaderboard"
import webhooks from "../src/handlers/webhook-register"
import unsubscribe from "../src/handlers/unsubscribe"

// Small read-only endpoints (and webhook registration) share one function, because the Vercel
// Hobby plan allows 12 per project. Routes in vercel.json map each public path to ?op=.
const OPS: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = { stats, diff, state, leaderboard, webhooks, unsubscribe }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const op = OPS[String(req.query.op || "")]
  if (!op) return res.status(404).json({ error: "Not found" })
  return op(req, res)
}
