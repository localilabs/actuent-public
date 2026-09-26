import { heuristicLAWP } from "./heuristic"

// Live-search version of actuent-crawler/rescue.ts: before a site is saved as minimal ("Website
// at …"), try the other addresses of its homepage (www., http://) and its llms.txt, then build the
// LAWP with the rule-based converter. Kept short so searches stay fast.

const UA = "Mozilla/5.0 (compatible; Actuent/1.0; +https://docs.actuent.ai/bot)"

async function get(url: string, ms: number): Promise<{ text: string, type: string } | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(ms) })
    return r.ok ? { text: (await r.text()).slice(0, 300_000), type: r.headers.get("content-type") || "" } : null
  } catch { return null }
}

export async function rescueLive(domain: string, html: string | null): Promise<any | null> {
  const bare = domain.replace(/^www\./, "")
  const [llms, ...homes] = await Promise.all([
    get(`https://${bare}/llms.txt`, 4000),
    ...(html ? [] : [`https://www.${bare}`, `http://${bare}`].filter(u => !u.includes(`//${domain}`) || u.startsWith("http:")).map(u => get(u, 5000)))
  ])
  for (const home of homes) {
    if (home && home.type.includes("html")) { const rules = heuristicLAWP(domain, home.text, true); if (rules?.actions?.length) return rules }
  }
  // llms.txt: the site's own summary for AI, read as markdown (title, summary and page links).
  if (llms && !/html|json/i.test(llms.type) && /^\s*#\s+\S/.test(llms.text)) {
    const title = llms.text.match(/^\s*#\s+(.+)$/m)?.[1]?.trim() || domain
    const summary = llms.text.match(/^\s*#[^\n]*\n+\s*>\s*([^\n]+)/)?.[1] || ""
    const rules = heuristicLAWP(domain, `Title: ${title}\n\nMarkdown Content:\n${summary}\n\n${llms.text}`, false)
    if (rules?.actions?.length) return rules
  }
  return null
}
