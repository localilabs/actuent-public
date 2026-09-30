// Facts about a shop for "A vs B" comparisons: how many products Actuent knows, their price range
// (EUR), where it says it ships, and whether it has delivery and returns pages.
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }

export async function shopFacts(site: any): Promise<object | null> {
  const d = encodeURIComponent(site.domain)
  const opts = { headers: HEADERS, signal: AbortSignal.timeout(2000) }
  const [count, cheapest, priciest, ships] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/lawp_items?select=url&domain=eq.${d}`, { ...opts, method: "HEAD", headers: { ...HEADERS, "Prefer": "count=exact", "Range": "0-0" } }).then(r => Number(r.headers.get("content-range")?.split("/")[1] || 0)).catch(() => 0),
    fetch(`${SUPABASE_URL}/rest/v1/lawp_items?select=price_eur&domain=eq.${d}&price_eur=gt.0&order=price_eur.asc&limit=1`, opts).then(r => r.ok ? r.json() : []).catch(() => []),
    fetch(`${SUPABASE_URL}/rest/v1/lawp_items?select=price_eur&domain=eq.${d}&price_eur=gt.0&order=price_eur.desc&limit=1`, opts).then(r => r.ok ? r.json() : []).catch(() => []),
    fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=ships_to&domain=eq.${d}`, opts).then(r => r.ok ? r.json() : []).catch(() => [])
  ])
  if (!count) return null
  const paths = Object.keys(site.pages || {}).join(" ")
  return {
    products: count,
    price_range_eur: cheapest[0] && priciest[0] ? [Number(cheapest[0].price_eur), Number(priciest[0].price_eur)] : null,
    ships_to: ships[0]?.ships_to || null,
    delivery_page: /shipping|delivery|levering|fragt|versand/i.test(paths),
    returns_page: /return|refund|retur|ruckgabe|rückgabe/i.test(paths)
  }
}
