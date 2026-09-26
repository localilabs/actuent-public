import type { VercelRequest, VercelResponse } from "@vercel/node"
import { readiness, ScoreBreakdown } from "../src/utils/score"
import { openNow } from "../src/utils/business"

// Public page for every indexed site: https://api.actuent.ai/site/<domain>
// Server-rendered for search engines. Thin (minimal) entries are marked noindex.
//   /site            → directory of agent-ready sites
//   /site/nike.com   → what AI agents see on nike.com

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }
const BASE = "https://api.actuent.ai"

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))
}

async function rows(path: string): Promise<any[]> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS })
    const data = r.ok ? await r.json() : []
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

const STYLE = `
:root{--bg:#0a0a0a;--surface:#13131a;--border:#2a2a34;--text:#f5f5f7;--muted:#a8a8b6;--soft:#c4c4cf;--accent:#ff8a3d;--good:#4ade80;--bad:#f87171}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px 16px 72px;line-height:1.5}
main{max-width:900px;margin:0 auto}
a{color:var(--accent)}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:36px}
.top img{height:22px}.top nav a{font-size:13px;margin-left:16px;text-decoration:none}
.eyebrow{color:var(--accent);font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px}
h1{font-size:36px;letter-spacing:-1px;line-height:1.15;margin-bottom:10px}
.lead{color:var(--soft);font-size:17px;margin-bottom:28px;max-width:720px}
h2{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);margin:34px 0 12px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px 20px;margin-bottom:10px}
.score{display:flex;gap:24px;align-items:center;flex-wrap:wrap}
.score .num{font-size:56px;font-weight:800;font-family:'Courier New',monospace;letter-spacing:-2px}
.checks{list-style:none;font-size:14px;color:var(--soft)}.checks li{padding:3px 0}
.ok{color:var(--good)}.no{color:var(--muted)}
.muted{color:var(--muted);font-size:13px}
.tag{display:inline-block;font-size:11px;padding:2px 8px;border-radius:20px;border:1px solid var(--border);color:var(--soft);margin:2px 4px 2px 0}
.tag.hot{background:var(--accent);color:#0a0a0a;border-color:var(--accent);font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.product{display:flex;gap:12px;align-items:center}.product img{width:56px;height:56px;object-fit:cover;border-radius:8px;background:#fff}
.price{font-family:'Courier New',monospace;color:var(--text);font-weight:700}
.cta{border-color:var(--accent)}
.list a{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);text-decoration:none;color:var(--soft)}
code{background:var(--bg);border:1px solid var(--border);padding:1px 6px;border-radius:4px;font-size:12px}
pre{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 14px;overflow-x:auto;font-size:12px;margin-top:8px;max-height:360px}
pre code{border:none;padding:0}
details summary{cursor:pointer;color:var(--accent);font-size:14px;margin-top:10px}
.fix{font-size:14px;color:var(--soft);padding:6px 0;border-bottom:1px solid var(--border)}.fix:last-child{border-bottom:none}.fix b{color:var(--text)}
.stars{color:var(--accent)}
@media(max-width:600px){h1{font-size:28px}.score .num{font-size:44px}}`

function layout(opts: { title: string, description: string, canonical: string, image: string, noindex?: boolean, jsonLd?: object, body: string }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title><meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${esc(opts.canonical)}">${opts.noindex ? '<meta name="robots" content="noindex,follow">' : ""}
<meta property="og:type" content="website"><meta property="og:title" content="${esc(opts.title)}"><meta property="og:description" content="${esc(opts.description)}">
<meta property="og:url" content="${esc(opts.canonical)}"><meta property="og:image" content="${esc(opts.image)}"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" href="${BASE}/assets/actuent-logo.png">
${opts.jsonLd ? `<script type="application/ld+json">${JSON.stringify(opts.jsonLd).replace(/</g, "\\u003c")}</script>` : ""}
<style>${STYLE}</style></head><body><main>
<div class="top"><a href="https://actuent.ai"><img src="${BASE}/assets/actuent-logo.png" alt="Actuent"></a><nav><a href="${BASE}/site">Directory</a><a href="https://humans.actuent.ai">Search</a><a href="https://docs.actuent.ai">Docs</a></nav></div>
${opts.body}
<p class="muted" style="margin-top:40px">Actuent is a search engine for AI agents, made by <a href="https://localilabs.com">localilabs</a>. Data is generated automatically from public web content and may be incomplete.</p>
</main></body></html>`
}

function starterLawp(site: any, domain: string) {
  const actions = ((site.actions || []) as any[]).map(({ endpoint, ...a }) => a)
  if (!actions.some(a => a.id === "contact")) actions.push({
    id: "contact", name: "Contact", description: `Send a message to ${site.name || domain}`, intent: ["contact", "message", "email", "get in touch"],
    input: { type: "object", required: true, fields: [
      { name: "name", type: "string", required: true }, { name: "email", type: "email", required: true }, { name: "message", type: "string", required: true }] }
  })
  return { lawp_version: "0.3", domain, name: site.name || domain, language: site.language || "en", pages: site.pages || {}, actions }
}

function starterSchema(site: any, domain: string) {
  return {
    "@context": "https://schema.org", "@type": "LocalBusiness", name: site.name || domain, url: `https://${domain}`,
    telephone: "+00 0000 0000", priceRange: "€€",
    address: { "@type": "PostalAddress", streetAddress: "Street 1", postalCode: "0000", addressLocality: "City", addressCountry: "DK" },
    openingHoursSpecification: [{ "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "09:00", closes: "17:00" }]
  }
}

function improveSection(site: any, domain: string, checks: ScoreBreakdown["checks"]) {
  const missing = checks.filter(c => !c.ok)
  if (!missing.length) return ""
  const gain = missing.reduce((n, c) => n + c.points, 0)
  const json = (v: unknown) => esc(JSON.stringify(v, null, 2))
  return `<h2>How to improve this score</h2><div class="card">
<div class="muted" style="margin-bottom:6px">Up to +${gain} points:</div>
${missing.map(c => `<div class="fix"><b>+${c.points} · ${esc(c.label)}</b><br>${c.fix}</div>`).join("")}
${!site.native ? `<details><summary>Starter lawp.json for ${esc(domain)}</summary><div class="muted" style="margin-top:8px">Made from what Actuent already knows. Edit it, then publish it at <code>https://${esc(domain)}/.well-known/lawp.json</code>. Check it with the <a href="https://docs.actuent.ai/#checker">LAWP Checker</a>, or edit it in the <a href="https://docs.actuent.ai/generator?domain=${esc(domain)}">LAWP Generator</a>.</div><pre><code>${json(starterLawp(site, domain))}</code></pre></details>` : ""}
${!site.business ? `<details><summary>Starter schema.org snippet</summary><div class="muted" style="margin-top:8px">Replace the example values, then paste into your homepage's &lt;head&gt;.</div><pre><code>${esc('<script type="application/ld+json">\n')}${json(starterSchema(site, domain))}${esc("\n</script>")}</code></pre></details>` : ""}
</div>`
}

function ogImage(title: string, subtitle: string, tag: string) {
  return `${BASE}/og?${new URLSearchParams({ title, subtitle, tag })}`
}

async function directory(res: VercelResponse) {
  const sites = await rows("lawp_sites?select=domain,name,native,actions&actions=neq.%5B%5D&order=native.desc,updated_at.desc&limit=120")
  const body = `<div class="eyebrow">Directory</div><h1>Agent-ready websites</h1>
<p class="lead">Websites AI agents can understand and act on through Actuent: their pages, and the actions an agent can take for you.</p>
<div class="card list">${sites.map(s => `<a href="${BASE}/site/${esc(s.domain)}"><span>${esc(s.name || s.domain)} <span class="muted">${esc(s.domain)}</span></span><span>${s.native ? '<span class="tag hot">Native LAWP</span>' : ""}<span class="tag">${(s.actions || []).length} actions</span></span></a>`).join("")}</div>`
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400")
  return res.status(200).send(layout({
    title: "Agent-ready websites — Actuent", description: "Websites AI agents can understand and act on, indexed by Actuent.",
    canonical: `${BASE}/site`, image: ogImage("Agent-ready websites", "Sites AI agents can understand and act on", "api.actuent.ai/site"), body
  }))
}

function notFound(res: VercelResponse, domain: string) {
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=600")
  return res.status(404).send(layout({
    title: `${domain} — not on Actuent yet`, description: `${domain} isn't in the Actuent index yet.`, canonical: `${BASE}/site/${domain}`,
    image: ogImage("Not indexed yet", domain, "api.actuent.ai"), noindex: true,
    body: `<h1>${esc(domain)} isn't on Actuent yet</h1><p class="lead">Search for it on <a href="https://humans.actuent.ai">humans.actuent.ai</a> and Actuent will index it, or <a href="https://docs.actuent.ai/#platforms">publish your own LAWP</a>.</p>`
  }))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  const domain = String(req.query.domain || "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/[^a-z0-9.-]/g, "")
  if (!domain) return directory(res)

  const [site] = await rows(`lawp_sites?select=*&domain=eq.${encodeURIComponent(domain)}`)
  if (!site) return notFound(res, domain)
  const products = await rows(`lawp_items?select=name,url,price,currency,image,available&domain=eq.${encodeURIComponent(domain)}&order=updated_at.desc&limit=12`)

  const { score, label, checks } = readiness(site)
  const pages = Object.entries(site.pages || {}) as [string, any][]
  const actions = (site.actions || []) as any[]
  const home = pages[0]?.[1]
  const name = site.name || domain
  const thin = !actions.length && !site.native
  const b = site.business
  const scoreColor = score >= 80 ? "var(--good)" : score >= 45 ? "var(--accent)" : "var(--bad)"
  const open = b ? openNow(b.opening_hours, b.address?.country) : null
  const description = home?.content && !/^Website at /.test(home.content)
    ? `${String(home.content).slice(0, 150)}${String(home.content).length > 150 ? "…" : ""}`
    : `What AI agents see on ${domain}: pages, actions and agent-readiness score.`

  const body = `<div class="eyebrow">${esc(domain)}</div>
<h1>${esc(name)}</h1>
<p class="lead">${esc(home?.content || `Actuent has indexed ${domain}.`)}</p>

<div class="card score"><div class="num" style="color:${scoreColor}">${score}</div><div><strong>${esc(label)}</strong><div class="muted">Agent-readiness score out of 100</div>
<ul class="checks" style="margin-top:8px">${checks.map(c => `<li class="${c.ok ? "ok" : "no"}">${c.ok ? "✓" : "○"} ${esc(c.label)}</li>`).join("")}</ul></div></div>

${improveSection(site, domain, checks)}

${actions.length ? `<h2>What AI agents can do here</h2>${actions.map(a => `<div class="card"><strong>${esc(a.name || a.id)}</strong>${a.endpoint && site.native ? ' <span class="tag hot">Executable</span>' : ""}<div class="muted">${esc(a.description || "")}</div>${(a.intent || []).slice(0, 6).map((t: string) => `<span class="tag">${esc(t)}</span>`).join("")}</div>`).join("")}` : ""}

${b ? `<h2>Business details</h2><div class="card">${b.rating ? `<div><span class="stars">★ ${esc(b.rating.value)}</span>${b.rating.best ? ` / ${esc(b.rating.best)}` : " / 5"}${b.rating.count ? ` <span class="muted">(${esc(b.rating.count)} reviews)</span>` : ""}</div>` : ""}${b.address ? `<div>${esc([b.address.street, b.address.postcode, b.address.city, b.address.country].filter(Boolean).join(", "))}</div>` : ""}${b.telephone ? `<div>☎ ${esc(b.telephone)}</div>` : ""}${b.price_range ? `<div class="muted">Price range: ${esc(b.price_range)}</div>` : ""}${open !== null ? `<div class="${open ? "ok" : "no"}">${open ? "Open now" : "Closed now"}</div>` : ""}${(b.opening_hours || []).map((h: any) => `<div class="muted">${esc(h.days.join(", "))}: ${esc(h.opens)}–${esc(h.closes)}</div>`).join("")}</div>` : ""}

${b?.offers?.length ? `<h2>Services &amp; prices</h2><div class="card">${(b.offers as any[]).slice(0, 30).map(o => `<div class="fix" style="display:flex;justify-content:space-between;gap:12px"><span>${esc(o.name)}${o.category ? ` <span class="muted">${esc(o.category)}</span>` : ""}</span><span class="price">${o.price != null ? `${esc(o.price)} ${esc(o.currency || "")}` : ""}</span></div>`).join("")}</div>` : ""}

${pages.length > 1 ? `<h2>Pages</h2>${pages.slice(0, 12).map(([path, p]) => `<div class="card"><strong>${esc(p.title || path)}</strong> <span class="muted">${esc(path)}</span><div class="muted">${esc(String(p.content || "").slice(0, 280))}</div></div>`).join("")}` : ""}

${products.length ? `<h2>Products</h2><div class="grid">${products.map(p => `<a class="card product" href="${esc(p.url)}" rel="nofollow noopener" target="_blank" style="text-decoration:none;color:inherit">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : ""}<div><div>${esc(p.name)}</div><div class="price">${p.price != null ? `${esc(p.price)} ${esc(p.currency || "")}` : ""}</div></div></a>`).join("")}</div>` : ""}

<h2>For AI agents</h2><div class="card"><div class="muted">Get this site as structured JSON:</div><code>GET ${BASE}/api/search?q=${esc(domain)}</code>
<div class="muted" style="margin-top:8px">Or connect Actuent to ChatGPT or Claude: <code>https://agents.actuent.ai/api/mcp</code></div>
<div class="muted" style="margin-top:8px">Last updated ${site.updated_at ? esc(new Date(site.updated_at).toUTCString().slice(5, 16)) : "recently"}${site.language && site.language !== "en" ? ` · original language: ${esc(site.language)}` : ""}</div></div>

<h2>Is this your site?</h2><div class="card cta"><div>Claim ${esc(domain)} to edit what AI agents see, make your actions executable, and show your score:</div>
<div style="margin-top:10px"><a href="https://analytics.actuent.ai">Claim this site →</a> &nbsp; <a href="https://docs.actuent.ai/#platforms">WordPress, Cloudflare &amp; Shopify →</a></div>
<div class="muted" style="margin-top:10px">Badge: <code>&lt;img src="${BASE}/badge.svg?domain=${esc(domain)}"&gt;</code></div></div>`

  const jsonLd = {
    "@context": "https://schema.org", "@type": "WebPage", name: `${name} — AI agent profile`, url: `${BASE}/site/${domain}`,
    about: { "@type": b?.type || "Organization", name, url: `https://${domain}`, ...(b?.telephone ? { telephone: b.telephone } : {}) }
  }
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400")
  return res.status(200).send(layout({
    title: `${name} (${domain}) — AI agent profile | Actuent`, description, canonical: `${BASE}/site/${domain}`,
    image: ogImage(`${name} is ${score}/100 agent-ready`, `What AI agents see on ${domain}: pages, actions${products.length ? " and products" : ""}`, `api.actuent.ai/site/${domain}`),
    noindex: thin, jsonLd, body
  }))
}
