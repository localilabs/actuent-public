import fs from "fs"
import path from "path"

// When the database can't answer (down, full, read-only, or too slow), search answers from a small
// built-in copy of the index: the 5,000 best-known sites and the next few days of events
// (actuent-crawler fallback_index.ts → data/fallback.json). It's read from this deploy first, else
// fetched from the crawler's public repo, which doesn't depend on Supabase at all.

type Fallback = { built_at: string, sites: [string, string, string, string, string][], events: [string, string, string, string, string, string, number | null, string, string?][] }
const REMOTE = "https://raw.githubusercontent.com/alfredmurray-goat/actuent-crawler/main/data/fallback.json"
let cached: { data: Fallback | null, at: number } | null = null

async function load(): Promise<Fallback | null> {
  if (cached && (cached.data || Date.now() - cached.at < 60000) && Date.now() - cached.at < 6 * 3600000) return cached.data
  let data: Fallback | null = null
  try { data = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "fallback.json"), "utf8")) } catch {}
  if (!data || Date.now() - Date.parse(data.built_at) > 3 * 86400000) {
    const r = await fetch(REMOTE, { signal: AbortSignal.timeout(4000) }).catch(() => null)
    const remote = r?.ok ? await r.json().catch(() => null) : null
    if (remote?.sites) data = remote
  }
  cached = { data, at: Date.now() }
  return data
}

const STOP = new Set(["the", "a", "an", "in", "on", "at", "of", "for", "to", "and", "or", "near", "me", "best", "top", "good", "cheap", "what", "whats", "is", "are", "open", "now", "today", "tonight", "this", "weekend", "week", "find", "show", "where", "can", "i", "buy", "any", "some", "with"])
const fold = (s: string) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
// "concerts" → "concert", "bakeries" → "bakery": a word matches any word that starts with its stem.
const stem = (w: string) => w.replace(/ies$/, "y").replace(/(ss)$/, "$1").replace(/s$/, "")
const tokens = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean)
const words = (q: string) => tokens(q).filter(w => w.length > 1 && !STOP.has(w)).map(stem)
const has = (hay: string[], w: string) => hay.some(t => t.startsWith(w))

// Event searches: what kind of event a word asks for, matched against the event's name and kind.
const EVENT_KINDS: [RegExp, RegExp][] = [
  [/^(concert|gig|music|live)$/, /concert|music|koncert|gig|jazz|rock|band/],
  [/^(comedy|standup|stand)$/, /comedy|stand-up|standup|improv/],
  [/^(market|flea)$/, /market|marked|flea/],
  [/^(kid|child|family)$/, /kids|child|family|børn|barn|2-4|3-6/],
  [/^(theatre|theater|play)$/, /theat|teater|play/]
]
const GENERIC_EVENT = /^(event|thing|do|happening|going|on|fun)$/

export async function fallbackSearch(query: string, city?: string | null, max = 10): Promise<{ results: any[], events: any[], built_at: string } | null> {
  const data = await load()
  if (!data) return null
  const cityWords = city ? words(city) : []
  const ws = words(query).filter(w => !cityWords.includes(w))
  const c = city ? fold(city) : null
  if (!ws.length && !c) return null

  // Sites: every word (all but one for searches of 4+ words) in the name, domain, category or summary.
  const need = ws.length <= 3 ? ws.length : ws.length - 1
  const results = !ws.length ? [] : data.sites.map(([domain, name, category, siteCity, summary], rank) => {
    const nameHay = tokens(`${domain.replace(/\.[a-z]+$/, "")} ${name}`), hay = [...nameHay, ...tokens(`${category} ${summary}`)]
    const hits = ws.filter(w => has(hay, w)).length
    if (hits < need) return null
    const inName = ws.filter(w => has(nameHay, w)).length
    const score = hits * 2 + inName * 3 + (c && fold(siteCity) === c ? 3 : 0) - rank / 2500
    return { score, site: { domain, name, category: category || undefined, snippet: summary || undefined, city: siteCity || undefined, visit_url: `https://${domain}`, source: "Actuent's built-in index (the live index is unavailable right now)" } }
  }).filter(Boolean).sort((a: any, b: any) => b.score - a.score).slice(0, max).map((x: any) => x.site)

  // Events: only with a city or an event word, in that city, of the kind asked for.
  const kinds = EVENT_KINDS.filter(([word]) => ws.some(w => word.test(w))).map(([, re]) => re)
  const topic = ws.filter(w => !GENERIC_EVENT.test(w) && !EVENT_KINDS.some(([word]) => word.test(w)))
  const eventy = kinds.length || ws.some(w => GENERIC_EVENT.test(w)) || !ws.length
  const events = !c && !kinds.length ? [] : !eventy && !c ? [] : data.events.filter(([name, , start, venue, eventCity, , , , kind]) => {
    if (Date.parse(start) < Date.now() - 6 * 3600000) return false
    if (c && fold(eventCity || "") !== c && !fold(venue || "").includes(c)) return false
    const text = fold(`${name} ${kind || ""}`)
    if (kinds.length && !kinds.some(re => re.test(text))) return false
    const hay = tokens(`${name} ${venue} ${kind || ""}`)
    return topic.every(w => has(hay, w)) && (eventy || topic.length > 0)
  }).slice(0, max).map(([name, url, start_date, venue, eventCity, country, price, currency, kind]) => ({ name, url, start_date, venue, city: eventCity, ...(kind ? { kind } : {}), country: country || undefined, ...(price != null ? { price, currency } : {}), source: "Actuent's built-in index" }))
  return { results: eventy && !topic.length ? [] : results, events, built_at: data.built_at }
}
