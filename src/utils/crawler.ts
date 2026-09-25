import { complete, Tier } from "./llm"
import { USER_AGENT, robotsAllows } from "./robots"
import { promises as dns } from "dns"
import { Site } from "../data/sites"
import { safeParseJSON } from "./parseAI"
import { diffLAWP, saveDiff } from "./diff"
import { fetchNativeSite } from "./native"
import { fetchProducts, saveProducts } from "./products"
import { heuristicLAWP } from "./heuristic"
import crypto from "crypto"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

// Turns scraped text (Jina Reader markdown or stripped HTML) into a plain readable snippet:
// drops Jina's "Title:/URL Source:/Markdown Content:" header lines, images, link targets and markdown.
function cleanScraped(text: string): string {
  return String(text || "")
    .replace(/^(Title|URL Source|Published Time|Warning|Markdown Content):.*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#*_>`|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function minimalLAWP(domain: string, content: string = ""): Site {
  const name = domain.split(".")[0]
  return {
    domain,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    pages: { "/": { title: domain, content: cleanScraped(content).slice(0, 200) || `Website at ${domain}` } },
    actions: []
  }
}

type SavedSite = Site & { contentHash?: string | null, ownerKey?: string | null, productsCrawledAt?: string | null }

export async function getSavedSite(domain: string): Promise<SavedSite | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lawp_sites?domain=eq.${domain}&select=*`,
      { headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` } }
    )
    const data = await res.json()
    if (!data || data.length === 0) return null
    const row = data[0]
    return {
      domain: row.domain, name: row.name, pages: row.pages, actions: row.actions, native: !!row.native,
      updated_at: row.updated_at || undefined, language: row.language || undefined, verified_owner: !!row.owner_key,
      contentHash: row.content_hash || null, ownerKey: row.owner_key || null, productsCrawledAt: row.products_crawled_at || null
    }
  } catch { return null }
}

async function saveSite(site: Site, language: string = "en", hash?: string): Promise<void> {
  const headers = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates"
  }
  const base = { domain: site.domain, name: site.name, pages: site.pages, actions: site.actions, language, updated_at: new Date().toISOString() }
  // Newest schema first; older databases lack native (lawp_actions.sql) or content_hash (groq_quota.sql).
  const attempts = [
    { ...base, native: !!site.native, ...(hash ? { content_hash: hash } : {}) },
    { ...base, native: !!site.native },
    base
  ]
  try {
    for (const body of attempts) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?on_conflict=domain`, { method: "POST", headers, body: JSON.stringify(body) })
      if (res.ok) return
    }
  } catch {}
}

async function savePage(domain: string, path: string, title: string, content: string, actions: any[]): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/lawp_pages?on_conflict=full_url`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
      },
      body: JSON.stringify({ domain, path, full_url: `${domain}${path}`, title, content, actions, updated_at: new Date().toISOString() })
    })
  } catch {}
}

async function getPageFromDB(fullUrl: string): Promise<any | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lawp_pages?full_url=eq.${encodeURIComponent(fullUrl)}&select=*`,
      { headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` } }
    )
    const data = await res.json()
    if (!data || data.length === 0) return null
    return data[0]
  } catch { return null }
}

async function scrapeWithJina(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { "Accept": "text/plain", "X-No-Cache": "true" },
      signal: AbortSignal.timeout(10000)
    })
    if (!res.ok) return null
    const text = await res.text()
    if (!text || text.length < 50) return null
    return text.slice(0, 3000)
  } catch { return null }
}

async function scrapeBasic(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return null
    const html = await res.text()
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000)
  } catch { return null }
}

async function fetchContent(url: string): Promise<string | null> {
  const jina = await scrapeWithJina(url)
  if (jina) return jina
  return await scrapeBasic(url)
}

async function convertToLAWP(domain: string, content: string, tier: Tier = "free"): Promise<Site> {
  try {
    const raw = await complete(`Convert this website into LAWP format.\n\nDomain: ${domain}\nContent: ${content.slice(0, 2000)}\n\nWrite every title, summary, description and intent in English, translating if the site is in another language. Set "language" to the ISO 639-1 code of the site's original language.\n\nReturn ONLY valid JSON:\n{"domain":"${domain}","name":"Site name","language":"en","pages":{"/":{"title":"Title","content":"Summary under 150 words"}},"actions":[{"id":"id","name":"Name","description":"What","intent":["k1","k2","k3"],"input":{"type":"text","required":false}}]}\n\nInclude 2-4 real actions only.`, 15000, tier)
    if (!raw) return minimalLAWP(domain, content)
    const parsed = safeParseJSON(raw)
    // Groq sometimes returns LAWP missing pages/actions; anything malformed falls back to minimal.
    const pages = parsed?.pages
    if (!pages || typeof pages !== "object" || Array.isArray(pages) || Object.keys(pages).length === 0) {
      return minimalLAWP(domain, content)
    }
    return {
      domain,
      name: typeof parsed.name === "string" && parsed.name ? parsed.name : minimalLAWP(domain).name,
      pages,
      actions: Array.isArray(parsed.actions) ? parsed.actions.filter((a: any) => a && a.id && Array.isArray(a.intent)) : [],
      language: typeof parsed.language === "string" && /^[a-z]{2}$/i.test(parsed.language) ? parsed.language.toLowerCase() : undefined
    }
  } catch {
    return minimalLAWP(domain, content)
  }
}

export async function crawlPage(domain: string, path: string, tier: Tier = "free"): Promise<any | null> {
  const fullUrl = `${domain}${path}`
  const cached = await getPageFromDB(fullUrl)
  if (cached) return cached

  if (!await robotsAllows(domain, path)) return null
  const content = await fetchContent(`https://${domain}${path}`)
  if (!content) return null

  let title = path.replace("/", "") || domain
  let summary = content.slice(0, 200)
  let actions: any[] = []

  try {
    const raw = await complete(`Convert to LAWP.\nDomain: ${domain}, Path: ${path}\nContent: ${content.slice(0, 2000)}\n\nWrite the title and summary in English, translating if needed. Return ONLY JSON: {"title":"Title","content":"Summary under 150 words","actions":[{"id":"id","name":"Name","description":"What","intent":["k1","k2"],"input":{"type":"text","required":false}}]}`, 15000, tier)
    const parsed = safeParseJSON(raw || "")
    if (parsed) {
      title = parsed.title || title
      summary = parsed.content || summary
      actions = parsed.actions || []
    }
  } catch {}

  await savePage(domain, path, title, summary, actions)
  return { domain, path, full_url: fullUrl, title, content: summary, actions }
}

async function domainExists(domain: string): Promise<boolean> {
  try {
    await Promise.race([
      dns.lookup(domain),
      new Promise((_, reject) => setTimeout(() => reject(new Error("dns timeout")), 3000))
    ])
    return true
  } catch { return false }
}

// Returns null (and saves nothing) for domains that don't exist, so made-up
// domains never end up in the index. Real sites that block us still get minimal LAWP.
async function rulesFromHtml(domain: string): Promise<Site | null> {
  try {
    const r = await fetch(`https://${domain}`, { headers: { "User-Agent": USER_AGENT, "Accept": "text/html" }, signal: AbortSignal.timeout(6000) })
    if (!r.ok || !(r.headers.get("content-type") || "").includes("html")) return null
    return heuristicLAWP(domain, (await r.text()).slice(0, 400_000), true)
  } catch { return null }
}

export async function crawlSite(domain: string, tier: Tier = "free"): Promise<Site | null> {
  // A site's own LAWP always wins over crawling.
  const native = await fetchNativeSite(domain)
  const existing = await getSavedSite(domain)
  const asResult = (saved: SavedSite): Site => ({
    domain: saved.domain, name: saved.name, pages: saved.pages, actions: saved.actions, native: saved.native,
    updated_at: saved.updated_at, language: saved.language, verified_owner: saved.verified_owner
  })
  // Respect robots.txt: if crawling is disallowed, serve what's already indexed (if anything).
  if (!native && !await robotsAllows(domain, "/")) return existing ? asResult(existing) : null
  // Claimed sites are edited by their owner; crawling must never overwrite them.
  if (!native && existing?.ownerKey) return asResult(existing)

  const content = native ? null : await fetchContent(`https://${domain}`)

  let site: Site

  const hash = content ? crypto.createHash("sha256").update(content).digest("hex").slice(0, 32) : undefined

  if (native) {
    site = native
  } else if (!content) {
    if (!await domainExists(domain)) return null
    site = minimalLAWP(domain)
  } else if (existing && existing.contentHash === hash && existing.actions?.length) {
    // The site hasn't changed since its last conversion: reuse it and spend no LLM tokens.
    return asResult(existing)
  } else {
    site = await convertToLAWP(domain, content, tier)
    // No LLM quota (or unusable output): build the LAWP from the page itself instead.
    if (!site.actions?.length) {
      const rules = heuristicLAWP(domain, content, !/^Title:/m.test(content)) ?? await rulesFromHtml(domain)
      if (rules) site = rules
    }
  }

  if (existing) {
    const changes = diffLAWP(existing, site)
    if (Object.keys(changes).length > 0) {
      await saveDiff(domain, existing, site, changes)
    }
  }

  await saveSite(site, site.language || "en", hash)
  const firstPage = Object.values(site.pages)[0]
  await savePage(domain, "/", firstPage?.title || domain, firstPage?.content || "", site.actions)

  // Shops: index products with prices, at most weekly, without holding up the response for long.
  const weekAgo = Date.now() - 7 * 86400_000
  if (!existing?.productsCrawledAt || Date.parse(existing.productsCrawledAt) < weekAgo) {
    await Promise.race([
      fetchProducts(domain).then(items => saveProducts(domain, items)),
      new Promise(r => setTimeout(r, 5000))
    ]).catch(() => {})
  }

  return { ...site, updated_at: new Date().toISOString() }
}