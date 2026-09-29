import type { VercelRequest, VercelResponse } from "@vercel/node"
import { answerFromSite, questionKeywords } from "../utils/answer"
import { rateLimit, ipHash } from "../utils/limits"

// /api/ask?domain=…&q=…: answer a question from one website's own pages ("is there parking?"),
// in the site's own words with the page each sentence came from. No AI involved: sentences that
// match the question. Used by the humans page, the "Ask this site" widget (ask.js) and agents.

const SUPABASE_URL = process.env.SUPABASE_URL!
const HEADERS = { "apikey": process.env.SUPABASE_SERVICE_KEY!, "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}` }

export default async function ask(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  const domain = String(req.query.domain || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").replace(/[^a-z0-9.-]/g, "")
  const q = String(req.query.q || "").replace(/\s+/g, " ").trim().slice(0, 200)
  if (!domain || !q) return res.status(400).json({ error: "Missing domain or q", message: "Use /api/ask?domain=example.com&q=your question" })
  const ip = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim()
  const limit = await rateLimit(`ask:${ipHash(ip)}`, 30)
  if (limit.limited) return res.status(429).json({ error: "Rate limit exceeded", message: `Too many questions. Please wait ${limit.reset} seconds.`, retry_after_seconds: limit.reset })

  const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=domain,name,pages,actions&domain=in.(${encodeURIComponent(`"${domain}","www.${domain}"`)})&limit=1`, { headers: HEADERS, signal: AbortSignal.timeout(4000) }).catch(() => null)
  // A slow or failing lookup isn't "not on Actuent": say it's busy, so people try again.
  if (!r?.ok) return res.status(503).json({ domain, question: q, sentences: [], message: "Sorry — too many people are using Actuent right now. Please try again in a minute.", retry_after_seconds: 30 })
  const site = (await r.json())[0]
  if (!site) return res.status(404).json({ domain, question: q, sentences: [], message: `${domain} isn't on Actuent yet. Search for it at humans.actuent.ai and it will be added.` })

  const answer = await answerFromSite(site, questionKeywords(q, `${site.name || ""} ${domain}`)).catch(() => null)
  // Actions that fit the question too ("can I book?" → the booking action).
  const words = questionKeywords(q)
  const actions = (site.actions || []).filter((a: any) => words.some(w => `${a.name} ${(a.intent || []).join(" ")}`.toLowerCase().includes(w)))
    .slice(0, 3).map((a: any) => ({ id: a.id, name: a.name, description: a.description, ...(a.url ? { url: a.url } : {}) }))
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400")
  return res.status(200).json({
    domain: site.domain, name: site.name || site.domain, question: q,
    sentences: answer?.sentences || [], actions,
    ...(answer?.sentences?.length ? { note: "Sentences from the site's own pages that match the question; check the page before relying on them." } : { message: `${site.name || domain}'s pages don't seem to answer that. Try other words, or visit the site.` })
  })
}
