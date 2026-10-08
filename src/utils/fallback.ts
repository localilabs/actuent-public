import fs from "fs"
import path from "path"

// When the database can't answer (down, full, read-only, or too slow), search answers from a small
// built-in copy of the index: the 5,000 best-known sites and the next few days of events
// (actuent-crawler fallback_index.ts → data/fallback.json). It's read from this deploy first, else
// fetched from the crawler's public repo, which doesn't depend on Supabase at all.

type Fallback = { built_at: string, sites: [string, string, string, string, string][], events: [string, string, string, string, string, string, number | null, string][] }
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

const STOP = new Set(["the", "a", "an", "in", "on", "at", "of", "for", "to", "and", "or", "near", "me", "best", "top", "good", "cheap", "what", "whats", "what's", "is", "are", "open", "now", "today", "tonight", "this", "weekend", "find", "show", "where", "can", "i", "buy"])
const words = (q: string) => q.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w))
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")

export async function fallbackSearch(query: string, city?: string | null, max = 10): Promise<{ results: any[], events: any[], built_at: string } | null> {
  const data = await load()
  if (!data) return null
  const ws = words(query)
  if (!ws.length) return null
  const c = city ? fold(city) : null
  const results = data.sites.map(([domain, name, category, siteCity, summary], rank) => {
    const hay = fold(`${domain} ${name} ${category} ${siteCity} ${summary}`)
    const hits = ws.filter(w => hay.includes(w)).length
    if (!hits) return null
    const inName = ws.filter(w => fold(`${domain} ${name}`).includes(w)).length
    const score = hits * 2 + inName * 3 + (c && fold(siteCity) === c ? 3 : 0) - rank / 2500
    return { score, site: { domain, name, category: category || undefined, snippet: summary || undefined, city: siteCity || undefined, visit_url: `https://${domain}`, source: "Actuent's built-in index (the live index is unavailable right now)" } }
  }).filter(Boolean).filter((x: any) => x.score >= Math.min(ws.length, 2) * 2).sort((a: any, b: any) => b.score - a.score).slice(0, max).map((x: any) => x.site)
  const eventWords = ws.filter(w => !/^(events?|concerts?|shows?|gigs?|things|do)$/.test(w))
  const events = data.events.filter(([name, , start, venue, eventCity]) => {
    if (Date.parse(start) < Date.now() - 6 * 3600000) return false
    if (c && fold(eventCity || "") !== c && !fold(venue || "").includes(c)) return false
    const hay = fold(`${name} ${venue} ${eventCity}`)
    return c ? eventWords.filter(w => !fold(c).includes(w)).every(w => hay.includes(w)) : eventWords.length > 0 && eventWords.every(w => hay.includes(w))
  }).slice(0, max).map(([name, url, start_date, venue, eventCity, country, price, currency]) => ({ name, url, start_date, venue, city: eventCity, country: country || undefined, ...(price != null ? { price, currency } : {}), source: "Actuent's built-in index" }))
  return { results, events, built_at: data.built_at }
}
