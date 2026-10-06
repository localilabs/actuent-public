// One thing, everywhere: a band, company, brand, venue or place, with everything Actuent knows about it
// joined up ("Cat Power" → who she is, her official site, her upcoming concerts; "Hoka" → the brand,
// hoka.com, its shoes with prices). Wikidata's ID (Q…) is the shared ID, so the same thing is the same
// record across sites. Computed live from Wikidata and Actuent's index; nothing new is stored.

const SUPABASE_URL = process.env.SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": KEY, "Authorization": `Bearer ${KEY}` }
const UA = { "User-Agent": "ActuentBot/1.0 (https://docs.actuent.ai/bot; support@localilabs.com)" }

const cache = new Map<string, { at: number, value: any }>()

async function json(url: string, headers: Record<string, string> = UA, ms = 6000): Promise<any> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms) }).catch(() => null)
  return r?.ok ? r.json().catch(() => null) : null
}

// Labels for Wikidata IDs (genres, countries, kinds), in one request.
async function labels(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {}
  const d = await json(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.slice(0, 50).join("|")}&props=labels&languages=en&format=json`)
  return Object.fromEntries(Object.entries(d?.entities || {}).map(([id, e]: any) => [id, e?.labels?.en?.value]).filter(([, v]) => v))
}

const claimIds = (e: any, p: string) => (e?.claims?.[p] || []).map((c: any) => c?.mainsnak?.datavalue?.value?.id).filter(Boolean) as string[]
const claimStr = (e: any, p: string) => (e?.claims?.[p] || []).map((c: any) => c?.mainsnak?.datavalue?.value).filter((v: any) => typeof v === "string") as string[]

export async function entity(name: string): Promise<any | null> {
  const q = name.replace(/\s+/g, " ").trim().slice(0, 80)
  if (q.length < 2) return null
  const hit = cache.get(q.toLowerCase())
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.value
  // 1. Which thing: Wikidata's best match for the name.
  // An exact name beats an alias ("Hoka" is a nickname of football, but the shoe brand is named Hoka).
  const found = await json(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&limit=7&format=json`)
  const list: any[] = found?.search || []
  const exact = (x: any) => String(x.label || "").toLowerCase() === q.toLowerCase() || String(x.label || "").toLowerCase().startsWith(`${q.toLowerCase()} `)
  const id = (list.find(x => exact(x) && x.match?.type === "label") || list.find(x => x.match?.type === "label") || list[0])?.id
  if (!id) return null
  const e = (await json(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${id}&props=labels|descriptions|claims|sitelinks&languages=en&format=json`))?.entities?.[id]
  if (!e) return null
  const label = e.labels?.en?.value || q
  const website = claimStr(e, "P856")[0]
  const domain = website ? (() => { try { return new URL(website).hostname.replace(/^www\./, "") } catch { return null } })() : null
  const named = await labels([...claimIds(e, "P31"), ...claimIds(e, "P136"), ...claimIds(e, "P17"), ...claimIds(e, "P495"), ...claimIds(e, "P159")])
  const pick = (p: string) => claimIds(e, p).map(i => named[i]).filter(Boolean)
  const wiki = e.sitelinks?.enwiki?.title
  const term = encodeURIComponent(label.replace(/[*,()]/g, ""))
  const now = encodeURIComponent(new Date().toISOString())
  // 2. Everything Actuent has on it, at once.
  const [summary, site, events, products] = await Promise.all([
    wiki ? json(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wiki)}`) : null,
    domain ? json(`${SUPABASE_URL}/rest/v1/lawp_sites?select=domain,name,category,business&domain=eq.${encodeURIComponent(domain)}`, HEADERS).then((r: any) => r?.[0] || null) : null,
    json(`${SUPABASE_URL}/rest/v1/lawp_events?select=name,start_date,venue,city,price,currency,url&name=ilike.*${term}*&start_date=gte.${now}&order=start_date.asc&limit=10`, HEADERS),
    // Whole word only ("Hoka", not "Pillars of Ashoka").
    json(`${SUPABASE_URL}/rest/v1/lawp_items?select=name,price,currency,url,domain&or=${encodeURIComponent(`(name.ilike.${label.replace(/[*,()]/g, "")} *,name.ilike.* ${label.replace(/[*,()]/g, "")} *,name.ilike.* ${label.replace(/[*,()]/g, "")})`)}&price=not.is.null&order=price_eur.asc&limit=8`, HEADERS)
  ])
  const value = {
    id, wikidata: `https://www.wikidata.org/wiki/${id}`, name: label, description: e.descriptions?.en?.value || null,
    kind: pick("P31"), ...(pick("P136").length ? { genres: pick("P136") } : {}),
    ...(pick("P17").length || pick("P495").length ? { country: pick("P17")[0] || pick("P495")[0] } : {}),
    ...(pick("P159").length ? { headquarters: pick("P159")[0] } : {}),
    ...(website ? { official_website: website } : {}),
    ...(summary?.extract ? { summary: summary.extract, wikipedia: summary.content_urls?.desktop?.page } : {}),
    ...(site ? { actuent_site: { domain: site.domain, name: site.name, category: site.category, page: `https://api.actuent.ai/site/${site.domain}` } } : {}),
    ...(Array.isArray(events) && events.length ? { upcoming_events: events } : {}),
    ...(Array.isArray(products) && products.length ? { products } : {}),
    note: "One record for this thing across sources: Wikidata (the shared ID), Wikipedia, and Actuent's own index of sites, events and products."
  }
  cache.set(q.toLowerCase(), { at: Date.now(), value })
  if (cache.size > 2000) cache.delete(cache.keys().next().value!)
  return value
}
