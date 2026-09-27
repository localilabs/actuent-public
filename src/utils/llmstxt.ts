// Copied from actuent-crawler/llmstxt.ts — keep in sync.
import { USER_AGENT } from "./robots"
import { fetchPublic } from "./safe-fetch"

// llms.txt (https://llmstxt.org): a Markdown file some sites publish for AI, with a summary and a
// list of their important pages ("- [Pricing](https://site.com/pricing): Plans and prices").
// Actuent uses it as extra input for conversion and turns its page list into LAWP pages.

export async function fetchLlmsTxt(domain: string): Promise<string | null> {
  try {
    const res = await fetchPublic(`https://${domain}/llms.txt`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(6000) })
    if (!res?.ok) return null
    const type = res.headers.get("content-type") || ""
    if (/html|json/i.test(type)) return null
    const text = (await res.text()).slice(0, 100_000)
    // Must look like llms.txt: starts with a Markdown H1.
    return /^\s*#\s+\S/.test(text) ? text : null
  } catch { return null }
}

// Page entries from llms.txt links on the site's own domain, as LAWP pages keyed by path.
export function llmsTxtPages(domain: string, text: string, max = 10): Record<string, { title: string, content: string }> {
  const site = domain.replace(/^www\./, "")
  const pages: Record<string, { title: string, content: string }> = {}
  for (const m of text.matchAll(/^\s*[-*]\s*\[([^\]]{1,120})\]\((\S+?)\)\s*(?::\s*(.+))?$/gm)) {
    let u: URL
    try { u = new URL(m[2], `https://${domain}`) } catch { continue }
    const host = u.hostname.replace(/^www\./, "")
    if (host !== site && !host.endsWith(`.${site}`)) continue
    const path = u.pathname.replace(/\.md$/, "").replace(/\/index$/, "/") || "/"
    if (path === "/" || pages[path]) continue
    pages[path] = { title: m[1].trim(), content: (m[3] || m[1]).trim().slice(0, 300) }
    if (Object.keys(pages).length >= max) break
  }
  return pages
}

// The llms.txt summary (the "> …" blockquote under the title), if any.
export function llmsTxtSummary(text: string): string | null {
  const m = text.match(/^\s*#[^\n]*\n+\s*>\s*([^\n]+)/)
  return m ? m[1].trim().slice(0, 400) : null
}

// Adds llms.txt pages to a LAWP (English sites only: LAWP text must be English).
export function withLlmsTxt(lawp: any, domain: string, text: string | null): any {
  if (!text || !lawp?.pages || (lawp.language && lawp.language !== "en")) return lawp
  const extra = llmsTxtPages(domain, text)
  const pages = { ...lawp.pages }
  for (const [path, page] of Object.entries(extra)) if (!pages[path] && Object.keys(pages).length < 20) pages[path] = page
  return { ...lawp, pages, llms_txt: true }
}

// What the LLM sees: the llms.txt summary and page list first (the site's own words for AI).
export function withLlmsTxtInput(pageText: string, text: string | null): string {
  return text ? `llms.txt:\n${text.slice(0, 1200)}\n\nHomepage:\n${pageText}` : pageText
}
