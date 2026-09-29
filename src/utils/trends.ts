import { queryCategories } from "./rank_extras"
import { splitCity } from "./local"
import { CATEGORIES, HIDDEN_CATEGORIES } from "./category"

// Search trends (api.actuent.ai/trends and /trends.json): what people searched most this week, by
// category and by city. Counted in the database (search_trends, list_eighteen.sql): only plain
// searches made at least 3 times, never our own test searches, never anything with an email address,
// a link or a long number. Counting starts on 30 September 2026, when test searches got their own label.

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" }
const COUNTING_FROM = Date.parse("2026-09-30T00:00:00Z")
const MIN_SEARCHES = 3

export type Trends = {
  since: string, available: boolean,
  top: { query: string, searches: number }[],
  categories: { id: string, label: string, searches: number, queries: { query: string, searches: number }[] }[],
  cities: { city: string, searches: number, queries: { query: string, searches: number }[] }[]
}

const titleCase = (s: string) => s.replace(/\b\p{L}/gu, c => c.toUpperCase())

export async function searchTrends(): Promise<Trends> {
  const since = new Date(Math.max(Date.now() - 7 * 86400000, COUNTING_FROM)).toISOString()
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_trends`, { method: "POST", headers: HEADERS, body: JSON.stringify({ since, min_count: MIN_SEARCHES, max_rows: 300 }), signal: AbortSignal.timeout(8000) }).catch(() => null)
  const rows: { query: string, searches: number }[] = r?.ok ? (await r.json()).map((x: any) => ({ query: x.query, searches: Number(x.searches) })) : []
  const byCategory = new Map<string, { query: string, searches: number }[]>()
  const byCity = new Map<string, { query: string, searches: number }[]>()
  const shown: { query: string, searches: number }[] = []
  for (const row of rows) {
    const cats = [...queryCategories(row.query)]
    if (cats.some(c => HIDDEN_CATEGORIES.has(c))) continue
    shown.push(row)
    for (const c of cats.slice(0, 2)) { if (!byCategory.has(c)) byCategory.set(c, []); byCategory.get(c)!.push(row) }
    const city = splitCity(row.query)?.city
    if (city) { const k = titleCase(city.toLowerCase()); if (!byCity.has(k)) byCity.set(k, []); byCity.get(k)!.push(row) }
  }
  const total = (list: { searches: number }[]) => list.reduce((n, x) => n + x.searches, 0)
  return {
    since, available: !!r?.ok,
    top: shown.slice(0, 30),
    categories: [...byCategory.entries()].filter(([id]) => CATEGORIES[id]).map(([id, list]) => ({ id, label: CATEGORIES[id], searches: total(list), queries: list.slice(0, 6) }))
      .sort((a, b) => b.searches - a.searches).slice(0, 12),
    cities: [...byCity.entries()].map(([city, list]) => ({ city, searches: total(list), queries: list.slice(0, 6) }))
      .sort((a, b) => b.searches - a.searches).slice(0, 12)
  }
}
