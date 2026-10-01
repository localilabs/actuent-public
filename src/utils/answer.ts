import { brandSites } from "./brand"
import { robotsAllows } from "./robots"

// Two kinds of search that aren't lists of sites:
//   • comparisons: "notion vs obsidian", "stripe or paypal" → both sites, side by side.
//   • questions about one site: "does basecamp have a free plan" → the site first, plus the
//     sentences from its own pages that answer it, with the page each came from.

const SUPABASE_URL = process.env.SUPABASE_URL!
const HEADERS = { "apikey": process.env.SUPABASE_SERVICE_KEY!, "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}` }

export function comparisonSides(q: string): [string, string] | null {
  const m = q.trim().match(/^(.{2,40}?)\s+(?:vs\.?|versus|or|compared to|compared with|against)\s+(.{2,40})$/i)
  if (!m) return null
  const a = m[1].trim(), b = m[2].trim()
  return a.split(/\s+/).length <= 3 && b.split(/\s+/).length <= 3 ? [a, b] : null
}

export async function comparison(q: string): Promise<any[] | null> {
  const sides = comparisonSides(q)
  if (!sides) return null
  const [a, b] = await Promise.all(sides.map(s => brandSites(s.toLowerCase().replace(/\.[a-z]{2,}$/, ""))))
  return a[0] && b[0] ? [a[0], b[0]] : null
}

const QUESTION = /^(does|do|is|are|can|could|how much|how many|how do i|how to|what|when|where|which|who|why|will)\b/i
const STOP = new Set("does do is are can could how much many what when where which who why will i you they it the a an of for to in on at with have has had there their your my any some cost costs price prices plan plans free open".split(" "))

// The site the question is about: the first word or two that match a site's name or domain.
export async function questionSite(q: string): Promise<{ site: any, keywords: string[] } | null> {
  if (!QUESTION.test(q.trim()) || q.split(/\s+/).length > 14) return null
  const words = q.toLowerCase().replace(/[?!.,]/g, " ").split(/\s+/).filter(Boolean)
  const candidates = words.filter(w => w.length >= 3 && !STOP.has(w)).slice(0, 4)
  const tries = [...candidates.slice(0, -1).map((w, i) => `${w} ${candidates[i + 1]}`), ...candidates]
  const found = await Promise.all(tries.map(t => brandSites(t).then(r => r[0] || null).catch(() => null)))
  const i = found.findIndex(Boolean)
  if (i < 0) return null
  const nameWords = new Set(tries[i].split(" "))
  return { site: found[i], keywords: words.filter(w => w.length >= 3 && !nameWords.has(w) && !["does", "have", "what", "when", "where", "which", "there"].includes(w)) }
}

// The words of a question worth looking for on a site's pages ("is there a free plan?" → ["free",
// "plan"]). Only question words go: unlike STOP (for spotting the site's name), "free", "plan" and
// "price" are exactly what to look for.
const QUESTION_WORDS = new Set("does do is are can could how much many what when where which who why will would should i you they it its the a an of for to in on at with have has had there their your my any some me we us our get".split(" "))
export function questionKeywords(q: string, siteName = ""): string[] {
  const nameWords = new Set(siteName.toLowerCase().split(/[\s.]+/))
  return q.toLowerCase().replace(/[?!.,]/g, " ").split(/\s+/).filter(w => w.length >= 3 && !QUESTION_WORDS.has(w) && !nameWords.has(w)).slice(0, 8)
}

export async function answerFromSite(site: any, keywords: string[]): Promise<{ domain: string, sentences: { text: string, url: string }[] } | null> {
  const pages: { url: string, text: string }[] = Object.entries(site.pages || {}).map(([path, p]: any) => ({ url: `https://${site.domain}${path}`, text: `${p?.title || ""}. ${p?.content || ""}` }))
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_pages?select=path,title,content&domain=eq.${encodeURIComponent(site.domain)}&limit=40`, { headers: HEADERS, signal: AbortSignal.timeout(2000) })
    for (const p of r.ok ? await r.json() : []) pages.push({ url: `https://${site.domain}${p.path}`, text: `${p.title || ""}. ${p.content || ""}` })
  } catch {}
  // Price and plan questions ("does notion have a free plan") when the site's pricing page isn't in
  // the index: read it live (a few seconds at most), so the answer comes from the right page.
  if (PRICING.test(keywords.join(" ")) && !pages.some(p => PRICING_PAGE.test(p.url))) {
    const live = await pricingPage(site.domain).catch(() => null)
    if (live) pages.push(live)
  }
  const stems = keywords.map(k => k.replace(/(ies|es|s)$/, ""))
  const scored: { text: string, url: string, score: number }[] = []
  for (const page of pages) {
    for (const sentence of page.text.split(/(?<=[.!?])\s+/)) {
      const s = sentence.trim(), lower = s.toLowerCase()
      if (s.length < 25 || s.length > 400) continue
      // Pricing pages count a little more for price questions; a sentence about something else that
      // shares one word ("unlimited forms for free") counts less than one about the plan itself.
      const score = stems.filter(k => k.length >= 3 && lower.includes(k)).length + (score0(page.url, keywords))
      if (score >= 1) scored.push({ text: s, url: page.url, score })
    }
  }
  const seen = new Set<string>()
  const best = scored.sort((a, b) => b.score - a.score).filter(x => !seen.has(x.text) && seen.add(x.text)).slice(0, 3)
  return best.length ? { domain: site.domain, sentences: best.map(({ text, url }) => ({ text, url })) } : null
}

const PRICING = /\b(free|plans?|price|prices|pricing|cost|costs|subscription|trial|cheap|paid)\b/i
const PRICING_PAGE = /\/(pricing|prices|plans|priser|preise|tarifs)\b/i
const score0 = (url: string, keywords: string[]) => PRICING.test(keywords.join(" ")) && PRICING_PAGE.test(url) ? 0.5 : 0

async function pricingPage(domain: string): Promise<{ url: string, text: string } | null> {
  const host = domain.replace(/^www\./, "")
  if (!await robotsAllows(host, "/pricing")) return null
  const r = await fetch(`https://${host}/pricing`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Actuent/1.0; +https://docs.actuent.ai/bot)", "Accept": "text/html" }, redirect: "follow", signal: AbortSignal.timeout(2500) })
  if (!r.ok || !(r.headers.get("content-type") || "").includes("html")) return null
  const html = (await r.text()).slice(0, 800_000)
  const text = html.replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<\/(p|div|li|h\d|td|section)>/gi, ". ").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(Number(c))).replace(/\s*\.\s*(\.\s*)+/g, ". ").replace(/\s+/g, " ")
  return { url: r.url || `https://${host}/pricing`, text }
}
