import "../src/utils/db_guard"
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
import sitemapPages from "../src/handlers/sitemap-pages"
import checkup from "../src/handlers/checkup"
import newsletter from "../src/handlers/newsletter"
import slack from "../src/handlers/slack"
import warm from "../src/handlers/warm"
import siteSearch from "../src/handlers/site-search"
import rates from "../src/handlers/rates"
import discord from "../src/handlers/discord"
import events from "../src/handlers/events"
import recentlyFixed from "../src/handlers/recently-fixed"
import player from "../src/handlers/player"

// Small read-only endpoints (and webhook registration) share one function, because the Vercel
// Hobby plan allows 12 per project. Routes in vercel.json map each public path to ?op=.
const OPS: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = { stats, diff, state, status, autocomplete, leaderboard, webhooks, unsubscribe, go, indexnow, ask, similar, tonight, sitemap_pages: sitemapPages, checkup, newsletter, slack, warm, site_search: siteSearch, rates, discord, events, recently_fixed: recentlyFixed, player }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const op = OPS[String(req.query.op || "")]
  if (!op) return res.status(404).json({ error: "Not found" })
  return op(req, res)
}
