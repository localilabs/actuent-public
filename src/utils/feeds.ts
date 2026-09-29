import type { VercelResponse } from "@vercel/node"

// Change feeds (RSS 2.0) from lawp_diffs:
//   api.actuent.ai/changes.rss                → recent changes across the whole index
//   api.actuent.ai/site/<domain>/changes.rss  → one site: new pages, retitled pages, actions added or removed
// Useful for agents that cache sites, and for people keeping an eye on a competitor.

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }
const BASE = "https://api.actuent.ai"

const xml = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!))

// Older rows (from live crawls) may have no description: a short one from the change list.
function summary(d: any): string {
  if (d.description) return String(d.description)
  const c = d.changes || {}
  const bits = [c.name ? "name changed" : "", c.pages ? `${Object.keys(c.pages).length} page(s) changed` : "", c.actions?.added ? `actions added: ${c.actions.added.join(", ")}` : "", c.actions?.removed ? `actions removed: ${c.actions.removed.join(", ")}` : ""].filter(Boolean)
  return bits.length ? bits.join("; ") : "Updated"
}

export async function changesFeed(res: VercelResponse, domain: string | null) {
  const filter = domain ? `&domain=eq.${encodeURIComponent(domain)}` : ""
  const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_diffs?select=domain,description,changes,detected_at${filter}&order=detected_at.desc&limit=${domain ? 30 : 60}`, { headers: HEADERS, signal: AbortSignal.timeout(5000) }).catch(() => null)
  const rows: any[] = r?.ok ? await r.json() : []
  const self = domain ? `${BASE}/site/${domain}/changes.rss` : `${BASE}/changes.rss`
  const title = domain ? `${domain} — changes seen by Actuent` : "Actuent — what changed on the web"
  const link = domain ? `${BASE}/site/${domain}` : `${BASE}/site`
  const items = rows.map(d => `<item>
<title>${xml(domain ? summary(d).slice(0, 110) : `${d.domain}: ${summary(d).slice(0, 100)}`)}</title>
<link>${BASE}/site/${xml(d.domain)}</link>
<guid isPermaLink="false">${xml(`${d.domain}#${d.detected_at}`)}</guid>
<pubDate>${new Date(d.detected_at).toUTCString()}</pubDate>
<description>${xml(summary(d))}</description>
</item>`).join("\n")
  res.setHeader("Content-Type", "application/rss+xml; charset=utf-8")
  res.setHeader("Access-Control-Allow-Origin", "*")
  // Failed lookups aren't cached, so a busy moment doesn't leave an empty feed behind.
  res.setHeader("Cache-Control", r?.ok ? "public, max-age=0, s-maxage=3600, stale-while-revalidate=21600" : "no-store")
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${xml(title)}</title>
<link>${link}</link>
<atom:link href="${self}" rel="self" type="application/rss+xml"/>
<description>${xml(domain ? `Changes Actuent noticed on ${domain} (pages, titles and the actions AI agents can take), newest first.` : "Changes Actuent noticed on websites in its index, newest first.")}</description>
<language>en</language>
<image><url>${BASE}/assets/lawpy/lawpy-idle.png</url><title>${xml(title)}</title><link>${link}</link></image>
${items}
</channel>
</rss>
`)
}
