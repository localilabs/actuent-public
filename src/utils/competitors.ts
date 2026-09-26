import { readiness } from "./score"
import { HIDDEN_CATEGORIES } from "./category"

// Similar sites for competitor views: same category, in the same city when the site has an
// address (otherwise the best-known sites in the category). Returns each one's score and the
// checks they pass that this site doesn't. Needs category (list_four.sql).
// Copied from actuent-crawler/competitors.ts — keep in sync.

export type Competitor = { domain: string, name: string, score: number }
export type Comparison = { category: string, city: string | null, rank: number, total: number, competitors: Competitor[], they_have: { label: string, count: number }[] }

type Get = (path: string) => Promise<any[]>

export async function compare(site: any, get: Get, max = 5): Promise<Comparison | null> {
  if (!site?.category || HIDDEN_CATEGORIES.has(site.category)) return null
  const city = site.business?.address?.city ? String(site.business.address.city) : null
  const base = `lawp_sites?select=domain,name,pages,actions,native,business&category=eq.${encodeURIComponent(site.category)}&status=is.null&domain=neq.${encodeURIComponent(site.domain)}&actions=neq.%5B%5D`
  let rows = city ? await get(`${base}&business->address->>city=ilike.${encodeURIComponent(city.replace(/[*,()]/g, ""))}&limit=40`) : []
  const local = rows.length >= 2
  if (!local) rows = await get(`${base}&native=is.true&limit=20`).then(async r => r.length >= max ? r : [...r, ...await get(`${base}&business=not.is.null&limit=40`)])
  if (!rows.length) return null
  const mine = readiness(site)
  const scored = rows.map(r => ({ row: r, result: readiness(r) })).sort((a, b) => b.result.score - a.result.score)
  const unique = scored.filter((x, i) => scored.findIndex(y => y.row.domain === x.row.domain) === i).slice(0, max)
  const theyHave: Record<string, number> = {}
  for (const { result } of unique) for (const c of result.checks) if (c.ok && !mine.checks.find(m => m.label === c.label)?.ok) theyHave[c.label] = (theyHave[c.label] || 0) + 1
  return {
    category: site.category, city: local ? city : null,
    rank: unique.filter(x => x.result.score > mine.score).length + 1, total: unique.length + 1,
    competitors: unique.map(({ row, result }) => ({ domain: row.domain, name: row.name || row.domain, score: result.score })),
    they_have: Object.entries(theyHave).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }))
  }
}
