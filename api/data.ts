import type { VercelRequest, VercelResponse } from "@vercel/node"
import stats from "../src/handlers/stats"
import diff from "../src/handlers/diff"
import state from "../src/handlers/state"
import status from "../src/handlers/status"
import autocomplete from "../src/handlers/autocomplete"
import leaderboard from "../src/handlers/leaderboard"
import webhooks from "../src/handlers/webhook-register"
import unsubscribe from "../src/handlers/unsubscribe"
import go from "../src/handlers/go"
import indexnow from "../src/handlers/indexnow"
import ask from "../src/handlers/ask"
import similar from "../src/handlers/similar"
import tonight from "../src/handlers/tonight"

// Small read-only endpoints (and webhook registration) share one function, because the Vercel
// Hobby plan allows 12 per project. Routes in vercel.json map each public path to ?op=.
const OPS: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = { stats, diff, state, status, autocomplete, leaderboard, webhooks, unsubscribe, go, indexnow, ask, similar, tonight }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const op = OPS[String(req.query.op || "")]
  if (!op) return res.status(404).json({ error: "Not found" })
  return op(req, res)
}
