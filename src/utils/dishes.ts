import { splitCity } from "./local"
import { PRICE_PHRASE } from "./products"
import { productMatches } from "./product_match"

// Dishes and services with prices from businesses' own menus (schema.org Menu / Offer data, saved as
// business.offers): "margherita under 100 kr copenhagen", "skin fade amsterdam". Local searches only.

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" }
const CURRENCY: Record<string, string> = { kr: "DKK", "kr.": "DKK", kroner: "DKK", dkk: "DKK", sek: "SEK", nok: "NOK", "€": "EUR", eur: "EUR", euro: "EUR", euros: "EUR", "$": "USD", usd: "USD", "£": "GBP", gbp: "GBP" }

export async function searchDishes(query: string): Promise<any[]> {
  const place = splitCity(query)
  if (!place) return []
  const m = place.what.match(PRICE_PHRASE)
  const what = (m ? place.what.replace(m[0], " ") : place.what).replace(/\s+/g, " ").trim()
  if (!what || what.split(" ").length > 5) return []
  const max = m ? Number(m[2].replace(",", ".")) : null
  const cur = m ? CURRENCY[(m[1] || m[3] || "").toLowerCase()] || null : null
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_lawp_offers`, { method: "POST", headers: HEADERS, body: JSON.stringify({ q: what, city: place.city, max_results: 40 }), signal: AbortSignal.timeout(2500) }).catch(() => null)
  const rows: any[] = r?.ok ? await r.json() : []
  return rows
    .filter(x => x.offer?.name && productMatches(what, `${x.offer.name} ${x.offer.category || ""}`))
    .filter(x => max == null || (x.offer.price != null && Number(x.offer.price) <= max && (!cur || !x.offer.currency || String(x.offer.currency).toUpperCase() === cur)))
    .sort((a, b) => (a.offer.price ?? Infinity) - (b.offer.price ?? Infinity))
    .slice(0, 8)
    .map(x => ({ name: x.offer.name, price: x.offer.price ?? null, currency: x.offer.currency ?? null, place: x.name || x.domain, domain: x.domain, city: x.business?.address?.city || place.city }))
}
