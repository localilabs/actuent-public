import { trackedLink } from "./links"

// "What is a cat?", "define serendipity", "photosynthesis meaning": general-knowledge questions get
// Wikipedia's summary first (its free page-summary API), instead of every site with "cat" in it.
// Not for questions about a site ("what is notion" finds notion.com first) or anything local or for sale.

const ASK = /^(?:what|who)\s*(?:'s|\s+(?:is|are|was|were))\s+(?:an?\s+|the\s+)?(.{2,50}?)\s*\??$/i
const DEFINE = /^(?:define|definition of|meaning of|what does)\s+(.{2,50}?)(?:\s+mean)?\s*\??$/i
const MEANING = /^(.{2,50}?)\s+(?:meaning|definition)\s*\??$/i
const NOT_A_DEFINITION = /\b(open|near|nearby|price|prices|cheap|cheapest|buy|best|in \w+|today|tonight|weather|time|score|news|latest|happening|on at|playing)\b|\d|\.[a-z]{2,}\b/i

export function definitionTerm(q: string): string | null {
  const t = q.trim()
  const m = t.match(ASK) || t.match(DEFINE) || t.match(MEANING)
  if (!m) return null
  const term = m[1].replace(/[?!.]+$/, "").trim()
  if (!term || term.split(/\s+/).length > 5 || NOT_A_DEFINITION.test(term)) return null
  return term
}

// "What is a cat" / "what's an API": with "a" or "an" it's always the thing, never a site's name.
export function isGeneric(q: string): boolean {
  return /^(?:what|who)\s*(?:'s|\s+(?:is|are|was|were))\s+an?\s+/i.test(q.trim())
}

export async function wikipediaSummary(term: string): Promise<{ title: string, description?: string, extract: string, url: string } | null> {
  const title = term.charAt(0).toUpperCase() + term.slice(1)
  const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s+/g, "_"))}?redirect=true`, {
    headers: { "User-Agent": "Actuent/1.0 (+https://docs.actuent.ai/bot; support@localilabs.com)", "Accept": "application/json" }, signal: AbortSignal.timeout(1500)
  }).catch(() => null)
  if (!r?.ok) return null
  const d: any = await r.json().catch(() => null)
  if (!d || d.type !== "standard" || !d.extract) return null
  return { title: d.title, description: d.description, extract: d.extract, url: d.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(d.title)}` }
}

// The Wikipedia page as a search result, and the answer sentences for the "answer" field.
export function definitionResult(w: { title: string, description?: string, extract: string, url: string }, query: string) {
  const sentences = w.extract.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ")
  const path = new URL(w.url).pathname
  return {
    result: {
      domain: "en.wikipedia.org", name: `${w.title} – Wikipedia`, pages: { [path]: { title: w.title, content: w.extract } },
      actions: [{ id: "visit", name: "Read on Wikipedia", description: `Read the Wikipedia article on ${w.title}`, intent: ["read", "learn", "info"], input: { type: "none", required: false }, url: w.url }],
      native: false, language: "en", category: "reference", snippet: sentences, score: 100, executable: false,
      matched: `definition of "${w.title}" from Wikipedia${w.description ? ` (${w.description})` : ""}`, visit_url: trackedLink(w.url, query)
    },
    answer: { domain: "en.wikipedia.org", sentences: [{ text: sentences, url: w.url }] }
  }
}

// Other results stay only when they're about the word and well known: the name has it as a word
// (not "RevenueCat" or "Bandwidth"), and it's in the top 100K sites. At most four.
export function aboutTheTerm(results: any[], term: string): any[] {
  const word = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i")
  return results.filter(r => word.test(String(r.name || "")) && Number(r.popularity_rank) > 0 && Number(r.popularity_rank) < 100000).slice(0, 4)
}
