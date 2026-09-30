import type { VercelRequest, VercelResponse } from "@vercel/node"
import crypto from "crypto"
import { later } from "../utils/later"
import { rateLimit } from "../utils/limits"

// /actuent in Slack: a slash command that searches Actuent and posts the answer in the channel.
// Slack gives a command 3 seconds, so this answers "Searching…" straight away and posts the results
// to the command's response_url (always https://hooks.slack.com/…, nothing else) when they're ready.
// Set up: docs.actuent.ai/slack (a one-paste app manifest, per workspace). If SLACK_SIGNING_SECRET is
// set, requests must carry Slack's signature; without it, anyone can run searches (they're public).

const BASE = "https://api.actuent.ai"

function signedBySlack(req: VercelRequest, raw: string): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET
  if (!secret) return true
  const ts = String(req.headers["x-slack-request-timestamp"] || ""), sig = String(req.headers["x-slack-signature"] || "")
  if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
  const mine = "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex")
  return mine.length === sig.length && crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(sig))
}

function blocks(query: string, data: any): any[] {
  const out: any[] = [{ type: "section", text: { type: "mrkdwn", text: `*Actuent* · ${query}` } }]
  if (data?.answer?.sentences?.length) out.push({ type: "section", text: { type: "mrkdwn", text: `> ${data.answer.sentences.slice(0, 2).map((s: any) => s.text).join(" ")}` } })
  for (const r of (data?.results || []).slice(0, 5)) {
    const home: any = Object.values(r.pages || {})[0] || {}
    const what = String(r.snippet || home.content || "").replace(/\s+/g, " ").slice(0, 140)
    out.push({ type: "section", text: { type: "mrkdwn", text: `*<https://${r.domain}|${String(r.name || r.domain).replace(/[<>|*]/g, "")}>*  ·  ${r.domain}${r.open_now === true ? "  ·  open now" : ""}\n${what}` } })
  }
  for (const p of (data?.products || []).slice(0, 3)) out.push({ type: "context", elements: [{ type: "mrkdwn", text: `🛍 <${p.url}|${String(p.name).replace(/[<>|]/g, "")}> · ${p.price} ${p.currency || ""} · ${p.domain}` }] })
  if (out.length === 1) out.push({ type: "section", text: { type: "mrkdwn", text: data?.message || "Nothing found." } })
  out.push({ type: "context", elements: [{ type: "mrkdwn", text: `<https://humans.actuent.ai/?q=${encodeURIComponent(query)}|See everything AI agents get →>` }] })
  return out
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Slack slash commands POST here. Set up: https://docs.actuent.ai/slack")
  const body: any = typeof req.body === "object" && req.body ? req.body : Object.fromEntries(new URLSearchParams(String(req.body || "")))
  const raw = new URLSearchParams(body).toString()
  if (!signedBySlack(req, raw)) return res.status(401).send("Bad signature")
  const query = String(body.text || "").trim().slice(0, 200)
  const responseUrl = String(body.response_url || "")
  if (!query) return res.status(200).json({ response_type: "ephemeral", text: "Try `/actuent vegan restaurants copenhagen` or `/actuent notion vs obsidian`." })
  // Replies go only to Slack's own reply address.
  if (!/^https:\/\/hooks\.slack\.com\//.test(responseUrl)) return res.status(400).send("Missing Slack response_url")
  if ((await rateLimit(`slack:${String(body.team_id || "x").slice(0, 20)}`, 20)).limited) return res.status(200).json({ response_type: "ephemeral", text: "Easy there! Try again in a minute." })
  await later((async () => {
    const data = await fetch(`${BASE}/api/search?q=${encodeURIComponent(query)}`, { headers: { "User-Agent": "Actuent-Slack/1.0" }, signal: AbortSignal.timeout(25000) }).then(r => r.json()).catch(() => null)
    await fetch(responseUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ response_type: "in_channel", replace_original: true, text: `Actuent: ${query}`, blocks: blocks(query, data) }) }).catch(() => {})
  })())
  return res.status(200).json({ response_type: "ephemeral", text: `Searching Actuent for “${query}”…` })
}
