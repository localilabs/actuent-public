// How results are presented: clean names, a snippet that answers the search, and pages that
// shouldn't be results at all (error pages, bot checks, parked domains) left out.

// "Home - Nike" / "Welcome to Nike" / "Nike | Official Site" → "Nike"
export function cleanName(name: string, domain: string): string {
  let n = String(name || "").replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(Number(c))).replace(/&#x([0-9a-f]+);/gi, (_, c) => String.fromCodePoint(parseInt(c, 16)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
  n = n.replace(/^(welcome to|home\s*[-|–—:]\s*|homepage\s*[-|–—:]\s*)/i, "").replace(/\s*[-|–—:]\s*(home|homepage|official (web)?site|welcome)$/i, "").trim()
  // Interstitial or bot-check titles saved as the name ("Hang Tight! Routing to checkout...", "Just a moment...").
  const junk = /^(hang tight|routing to|just a moment|please wait|one moment|loading(\.\.\.|…|\s*$)|redirecting|access denied|attention required|checking your browser|are you a robot|security check|pardon our interruption)/i.test(n)
  if (/^(home|homepage|index|untitled|welcome|website)$/i.test(n) || !n || junk) {
    const label = domain.split("/")[0].replace(/^www\./, "").split(".")[0]
    n = label.charAt(0).toUpperCase() + label.slice(1)
  }
  // Page titles used as names ("宜家家居官网-家 给生活更多-…- IKEA", "Buy Furniture Online: Upto 70% off…"):
  // the part that is the site's own name (matches the domain), else the first part of a long title.
  const parts = n.split(/\s+[-|–—·]\s+|\s*[|｜–—]\s*|:\s+|(?<=[^\x00-\x7F])\s*-|-\s*(?=[^\x00-\x7F])/).map(x => x.trim()).filter(Boolean)
  if (parts.length > 1) {
    const label = domain.split("/")[0].replace(/^www\./, "").split(".")[0].toLowerCase().replace(/[^a-z0-9]/g, "")
    const own = parts.find(x => { const w = x.toLowerCase().replace(/[^a-z0-9]/g, ""); return w.length >= 3 && (w === label || (label.length >= 4 && (label.startsWith(w) || w.startsWith(label)))) })
    if (own) n = own
    else if (n.length > 50) n = parts[0]
  }
  return n.slice(0, 100)
}

const ERROR_PAGE = /\b(404|page not found|not found|access denied|forbidden|just a moment|checking your browser|attention required|enable javascript and cookies|captcha|site can'?t be reached|account suspended|bandwidth limit exceeded)\b/i
const PARKED = /\b(this domain (is|may be) for sale|buy this domain|domain for sale|parked (free|domain)|is parked|domain has expired|renew (this|your) domain|coming soon — this domain)\b/i
export function notAResult(site: { name?: string, pages?: Record<string, any> }): boolean {
  const home = String(Object.values(site.pages || {})[0]?.content || "")
  const text = `${site.name || ""} ${home.slice(0, 300)}`
  // Only when the page is mostly that message (a real site can mention "not found" in passing).
  return (home.length < 400 && ERROR_PAGE.test(text)) || PARKED.test(text)
}

// Near-empty sites: nothing but "Website at x.com" / "a Danish-language website at x.dk", one page
// and no actions. Useless as a keyword result (they're shown for their own domain, and come back
// once converted properly).
export function nearlyEmpty(site: { domain?: string, pages?: Record<string, any>, actions?: any[], business?: any }): boolean {
  if ((site.actions || []).length || site.business) return false
  const pages = Object.values(site.pages || {})
  if (pages.length > 1) return false
  const text = String(pages[0]?.content || "").trim()
  return !text || /^(website at |[\w-]+ is an? [\w-]+-language website at )/i.test(text) || text.length < 40
}

// The sentence from the site's pages that answers the search best (for showing under the result),
// cut to ~200 characters. Every page counts (pricing, about, contact…), and a page whose address
// or title is about the search ("free plan" → /pricing) is preferred. "plans" matches "plan".
const PAGE_HINTS: [RegExp, RegExp][] = [
  [/\b(price|prices|pricing|cost|costs|plan|plans|free|subscription)\b/, /pric|plan/],
  [/\b(contact|phone|email|address|support)\b/, /contact|support/],
  [/\b(about|who|team|company|founded)\b/, /about|team|company/],
  [/\b(hours|opening|open)\b/, /hours|opening|visit/],
  [/\b(menu|food|dishes)\b/, /menu/],
  [/\b(jobs?|careers?|hiring)\b/, /career|jobs/]
]
export function snippet(site: { pages?: Record<string, any> }, query: string): string | undefined {
  const q = query.toLowerCase()
  const words = q.split(/\s+/).filter(w => w.length > 2).map(w => w.length > 4 ? w.replace(/(ies|es|s)$/, "") : w)
  const hints = PAGE_HINTS.filter(([asks]) => asks.test(q)).map(([, path]) => path)
  let best = "", bestScore = -1
  for (const [path, page] of Object.entries(site.pages || {})) {
    const text = String(page?.content || "")
    const about = `${path} ${page?.title || ""}`.toLowerCase()
    const pageBonus = (hints.some(h => h.test(about)) ? 12 : 0) + words.filter(w => about.includes(w)).length * 3
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const s = sentence.trim()
      if (s.length < 30) continue
      const lower = s.toLowerCase()
      const hits = words.filter(w => lower.includes(w)).length
      const score = hits * 10 + (hits ? pageBonus : pageBonus / 4) - Math.abs(s.length - 140) / 40
      if (score > bestScore) { bestScore = score; best = s }
    }
  }
  if (!best) return undefined
  return best.length > 220 ? best.slice(0, 217).replace(/\s+\S*$/, "") + "…" : best
}
