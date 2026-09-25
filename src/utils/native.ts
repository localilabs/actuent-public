import { Site } from "../data/sites"
import { USER_AGENT } from "./robots"

// A site's own LAWP from https://<domain>/.well-known/lawp.json. Sites that publish one are
// "native": their LAWP is used as-is instead of crawling, and they get a ranking boost.
export async function fetchNativeSite(domain: string): Promise<Site | null> {
  try {
    const res = await fetch(`https://${domain}/.well-known/lawp.json`, {
      headers: { "Accept": "application/json", "User-Agent": USER_AGENT },
      redirect: "manual",
      signal: AbortSignal.timeout(5000)
    })
    if (!res.ok) return null
    const text = await res.text()
    if (text.length > 200_000) return null
    const doc = JSON.parse(text)
    const pages = doc?.pages
    if (!pages || typeof pages !== "object" || Array.isArray(pages) || Object.keys(pages).length === 0) return null
    if (!Array.isArray(doc.actions)) return null
    return {
      domain,
      name: typeof doc.name === "string" && doc.name ? doc.name : domain,
      pages,
      actions: doc.actions.filter((a: any) => a && typeof a.id === "string"),
      native: true
    }
  } catch { return null }
}

// An action can be performed by agents when the site's own LAWP gives it an https endpoint.
export function isExecutable(site: Site): boolean {
  return !!site.native && (site.actions || []).some((a: any) => typeof a?.endpoint?.url === "string" && a.endpoint.url.startsWith("https://"))
}
