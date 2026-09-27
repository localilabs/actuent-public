import { Site } from "../data/sites"
import { USER_AGENT } from "./robots"
import { discoverLawp, normalizeLawp } from "./discover"
import { fetchPublic } from "./safe-fetch"

// A site's own LAWP (LAWP 0.4 discovery: /.well-known/lawp.json, or a file its homepage or robots.txt
// links to). Sites that publish one are "native": their LAWP is used as-is instead of crawling, and
// they get a ranking boost. With `html` (the homepage, already fetched) only a linked file is checked.
export async function fetchNativeSite(domain: string, html?: string | null): Promise<Site | null> {
  if (html !== undefined) {
    if (!html || !/rel\s*=\s*["']?lawp/i.test(html)) return null
  }
  const doc = html === undefined ? await wellKnownOnly(domain) : (await discoverLawp(domain))?.doc
  if (!doc) return null
  return {
    domain,
    name: typeof doc.name === "string" && doc.name ? doc.name : domain,
    pages: doc.pages,
    actions: doc.actions.filter((a: any) => a && typeof a.id === "string"),
    native: true,
    ...(doc.language ? { language: doc.language } : {}),
    // LAWP 0.4: businesses describe themselves (address, hours, offers).
    ...(doc.business && typeof doc.business === "object" ? { business: doc.business } : {})
  }
}

// Fast path for live search: only /.well-known/lawp.json (bare domain, then www.).
async function wellKnownOnly(domain: string): Promise<any | null> {
  for (const host of domain.startsWith("www.") ? [domain] : [domain, `www.${domain}`]) {
    try {
      const res = await fetchPublic(`https://${host}/.well-known/lawp.json`, {
        headers: { "Accept": "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(5000)
      }, 0)
      if (!res?.ok) continue
      const text = await res.text()
      if (text.length > 1_000_000) continue
      const doc = JSON.parse(text)
      const pages = doc?.pages
      if (!pages || typeof pages !== "object" || Array.isArray(pages) || !Object.keys(pages).length || !Array.isArray(doc.actions)) continue
      return await normalizeLawp(doc, domain)
    } catch {}
  }
  return null
}

// An action can be performed by agents when the site's own LAWP gives it an https endpoint.
export function isExecutable(site: Site): boolean {
  return !!site.native && (site.actions || []).some((a: any) => typeof a?.endpoint?.url === "string" && a.endpoint.url.startsWith("https://"))
}
