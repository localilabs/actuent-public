// LAWP 0.4 discovery: a site's own LAWP from /.well-known/lawp.json (bare domain or www.), or —
// for platforms that can't serve that path (Shopify, Squarespace, Wix, Webflow…) — a file linked
// from its homepage (Link header or <link rel="lawp">) or its robots.txt ("LAWP: <url>").
// Then normalised: the English translation is used when the document is in another language, and
// extra page files (more_pages) are merged in.
// Copied from actuent-crawler/discover.ts — keep in sync.

export type Discovery = "well-known" | "link-header" | "html-link" | "robots"

const UA = "Mozilla/5.0 (compatible; Actuent/1.0; +https://docs.actuent.ai/bot)"
const bare = (h: string) => h.toLowerCase().replace(/^www\./, "")

async function getJson(url: string): Promise<any | null> {
  try {
    const u = new URL(url)
    if (u.protocol !== "https:") return null
    const res = await fetch(u, { headers: { "Accept": "application/json", "User-Agent": UA }, redirect: "manual", signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const text = await res.text()
    return text.length > 1_000_000 ? null : JSON.parse(text)
  } catch { return null }
}

function valid(doc: any, domain: string): boolean {
  const pages = doc?.pages
  return !!doc && Array.isArray(doc.actions) && !!pages && typeof pages === "object" && !Array.isArray(pages) && Object.keys(pages).length > 0
    && (!doc.domain || bare(String(doc.domain).replace(/^https?:\/\//, "").split("/")[0]) === bare(domain))
}

async function linked(domain: string): Promise<{ url: string, via: Discovery } | null> {
  try {
    const res = await fetch(`https://${domain}/`, { headers: { "Accept": "text/html", "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(6000) })
    if (bare(new URL(res.url).hostname) === bare(domain)) {
      const header = (res.headers.get("link") || "").split(/,(?=\s*<)/).map(p => p.match(/<([^>]+)>\s*;(.*)$/)).find(m => m && /rel\s*=\s*"?lawp"?/i.test(m[2]))
      if (header) return { url: new URL(header[1], res.url).toString(), via: "link-header" }
      const head = (await res.text()).slice(0, 300_000).split(/<\/head>/i)[0]
      for (const tag of head.match(/<link\b[^>]*>/gi) || []) {
        if (!/\brel\s*=\s*["']?lawp["']?/i.test(tag)) continue
        const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]
        if (href) return { url: new URL(href, res.url).toString(), via: "html-link" }
      }
    }
  } catch {}
  try {
    const res = await fetch(`https://${domain}/robots.txt`, { headers: { "User-Agent": UA }, redirect: "manual", signal: AbortSignal.timeout(4000) })
    const line = res.ok ? (await res.text()).slice(0, 200_000).match(/^\s*LAWP\s*:\s*(\S+)/mi) : null
    if (line) return { url: line[1], via: "robots" }
  } catch {}
  return null
}

export async function normalizeLawp(doc: any, domain: string): Promise<any> {
  const out = { ...doc }
  const en = doc.translations?.en
  if (doc.language && doc.language !== "en" && en) {
    if (en.name) out.name = en.name
    if (en.pages) out.pages = { ...doc.pages, ...en.pages }
    if (en.actions) out.actions = (doc.actions || []).map((a: any) => en.actions[a?.id] ? { ...a, ...en.actions[a.id] } : a)
    out.language = "en"
  }
  const site = bare(domain)
  const files = (Array.isArray(doc.more_pages) ? doc.more_pages : []).filter((u: string) => {
    try { const h = bare(new URL(u).hostname); return h === site || h.endsWith(`.${site}`) } catch { return false }
  }).slice(0, 50)
  if (files.length) {
    out.pages = { ...out.pages }
    for (const part of await Promise.all(files.map(getJson))) {
      if (part?.pages && typeof part.pages === "object") for (const [path, page] of Object.entries(part.pages)) if (!out.pages[path]) out.pages[path] = page
    }
  }
  return out
}

export async function discoverLawp(domain: string): Promise<{ doc: any, via: Discovery } | null> {
  const hosts = domain.startsWith("www.") ? [domain] : [domain, `www.${domain}`]
  for (const h of hosts) {
    const doc = await getJson(`https://${h}/.well-known/lawp.json`)
    if (valid(doc, domain)) return { doc: await normalizeLawp(doc, domain), via: "well-known" }
  }
  const link = await linked(domain)
  if (link) {
    const doc = await getJson(link.url)
    if (valid(doc, domain)) return { doc: await normalizeLawp(doc, domain), via: link.via }
  }
  return null
}
