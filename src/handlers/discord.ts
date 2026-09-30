import type { VercelRequest, VercelResponse } from "@vercel/node"
import { later } from "../utils/later"

// /actuent in Discord. Each server's Discord app points its Interactions Endpoint URL at
//   https://api.actuent.ai/api/discord/<the app's public key>
// so no secret is stored anywhere: every request is checked against that public key (Ed25519, as
// Discord requires). Discord waits 3 seconds, so this says "thinking…" (deferred) and edits the reply
// when the search is done, through Discord's interaction webhook (no bot token needed).
// Runs on Supabase Edge Functions: the signature is over the raw body, which the adapter keeps.
// Setup: docs.actuent.ai/discord.

const BASE = "https://api.actuent.ai"
const hex = (h: string) => new Uint8Array((h.match(/../g) || []).map(b => parseInt(b, 16)))

async function rawBody(req: any): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  for await (const c of req) chunks.push(typeof c === "string" ? new TextEncoder().encode(c) : c)
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let i = 0
  for (const c of chunks) { out.set(c, i); i += c.length }
  return out
}

async function verified(publicKey: string, signature: string, timestamp: string, body: Uint8Array): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", hex(publicKey), { name: "Ed25519" }, false, ["verify"])
    const msg = new Uint8Array([...new TextEncoder().encode(timestamp), ...body])
    return await crypto.subtle.verify({ name: "Ed25519" }, key, hex(signature), msg)
  } catch { return false }
}

function answer(query: string, data: any): string {
  const lines = [`**Actuent** · ${query}`]
  for (const r of (data?.results || []).slice(0, 5)) {
    const home: any = Object.values(r.pages || {})[0] || {}
    const what = String(r.snippet || home.content || "").replace(/\s+/g, " ").slice(0, 120)
    lines.push(`• **${String(r.name || r.domain).replace(/[*_`]/g, "")}** <https://${r.domain}>${r.open_now === true ? " · open now" : ""}\n  ${what}`)
  }
  for (const p of (data?.products || []).slice(0, 3)) lines.push(`🛍 ${String(p.name).replace(/[*_`]/g, "")} · ${p.price} ${p.currency || ""} · <${p.url}>`)
  if (lines.length === 1) lines.push(data?.message || "Nothing found.")
  lines.push(`<https://humans.actuent.ai/?q=${encodeURIComponent(query)}>`)
  return lines.join("\n").slice(0, 1990)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const publicKey = String(req.query.key || "").toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(publicKey)) return res.status(404).json({ error: "Use /api/discord/<your app's public key>" })
  const body = await rawBody(req)
  const ok = await verified(publicKey, String(req.headers["x-signature-ed25519"] || ""), String(req.headers["x-signature-timestamp"] || ""), body)
  if (!ok) return res.status(401).send("invalid request signature")
  const i = JSON.parse(new TextDecoder().decode(body))
  if (i.type === 1) return res.status(200).json({ type: 1 }) // PING
  if (i.type !== 2) return res.status(400).json({ error: "Unsupported interaction" })
  const query = String((i.data?.options || []).find((o: any) => o.name === "query")?.value || "").trim().slice(0, 200)
  if (!query) return res.status(200).json({ type: 4, data: { content: "Try `/actuent query: vegan restaurants copenhagen`", flags: 64 } })
  await later((async () => {
    const data = await fetch(`${BASE}/api/search?q=${encodeURIComponent(query)}`, { headers: { "User-Agent": "Actuent-Discord/1.0" }, signal: AbortSignal.timeout(25000) }).then(r => r.json()).catch(() => null)
    await fetch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}/messages/@original`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: answer(query, data), allowed_mentions: { parse: [] } })
    }).catch(() => {})
  })())
  return res.status(200).json({ type: 5 }) // "Actuent is thinking…"
}
