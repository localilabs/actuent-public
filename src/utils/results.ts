// How results are presented: clean names, a snippet that answers the search, and pages that
// shouldn't be results at all (error pages, bot checks, parked domains) left out.

// "Home - Nike" / "Welcome to Nike" / "Nike | Official Site" → "Nike"
export function cleanName(name: string, domain: string): string {
  let n = String(name || "").replace(/\s+/g, " ").trim()
  n = n.replace(/^(welcome to|home\s*[-|–—:]\s*|homepage\s*[-|–—:]\s*)/i, "").replace(/\s*[-|–—:]\s*(home|homepage|official (web)?site|welcome)$/i, "").trim()
  if (/^(home|homepage|index|untitled|welcome|website)$/i.test(n) || !n) {
    const label = domain.split("/")[0].replace(/^www\./, "").split(".")[0]
    n = label.charAt(0).toUpperCase() + label.slice(1)
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

// The sentence from the site's pages that matches the most search words (for showing under the
// result), cut to ~200 characters.
export function snippet(site: { pages?: Record<string, any> }, query: string): string | undefined {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  let best = "", bestScore = -1
  for (const page of Object.values(site.pages || {})) {
    const text = String(page?.content || "")
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const s = sentence.trim()
      if (s.length < 30) continue
      const lower = s.toLowerCase()
      const score = words.filter(w => lower.includes(w)).length * 10 - Math.abs(s.length - 140) / 40
      if (score > bestScore) { bestScore = score; best = s }
    }
  }
  if (!best) return undefined
  return best.length > 220 ? best.slice(0, 217).replace(/\s+\S*$/, "") + "…" : best
}
