import { parseOpeningHoursText, openNow, todayHours } from "./business"

// Opening hours of a named place for "is the Louvre open on Monday?", "when does SMK close?",
// "British Museum opening hours": OpenStreetMap (Nominatim) has them for most museums, landmarks and
// attractions, even when their own website can't be read. One lookup, cached for a day.

export const HOURS_QUESTION = /\b(open|opens|opening|hours|close|closes|closing|closed)\b/i
// Words that aren't the place's name.
const NOT_NAME = /\b(is|are|the|a|an|it|open|opens|opening|hours|time|times|close|closes|closing|closed|on|at|in|what|when|does|do|today|tonight|tomorrow|now|right|this|weekend|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays|christmas|holiday|holidays|still|until|till|how|late|early|and|or|of|for|visiting|visit)\b|[?!.,]/gi
const KINDS = /^(tourism|amenity|leisure|historic|building|shop|office)$/

const cache = new Map<string, { at: number, value: any }>()
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; Actuent/1.0; +https://docs.actuent.ai/bot)", "Accept-Language": "en" }

export function placeName(question: string): string | null {
  const name = question.replace(NOT_NAME, " ").replace(/\s+/g, " ").trim()
  const n = name.split(" ").filter(Boolean).length
  return n >= 1 && n <= 5 && name.length >= 3 ? name : null
}

export async function landmarkHours(question: string): Promise<any | null> {
  if (!HOURS_QUESTION.test(question)) return null
  const name = placeName(question)
  if (!name) return null
  const key = name.toLowerCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 86400_000) return hit.value
  let value: any = null
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=jsonv2&limit=5&extratags=1&addressdetails=1`, { headers: HEADERS, signal: AbortSignal.timeout(3500) })
    const list: any[] = r.ok ? await r.json() : []
    const p = list.find(x => KINDS.test(String(x.category)) && x.extratags?.opening_hours && Number(x.importance || 0) >= 0.3)
    if (p) {
      const hours = parseOpeningHoursText(p.extratags.opening_hours)
      const country = String(p.address?.country_code || "").toUpperCase(), lon = Number(p.lon)
      value = {
        name: p.name || name, opening_hours: p.extratags.opening_hours,
        open_now: hours.length ? openNow(hours, country, new Date(), undefined, lon) : null,
        ...(todayHours(hours, country, lon) || {}),
        address: [p.address?.road, p.address?.city || p.address?.town, p.address?.country].filter(Boolean).join(", "),
        ...(p.extratags.website ? { website: p.extratags.website } : {}),
        source: "OpenStreetMap", attribution: "© OpenStreetMap contributors, ODbL",
        map: `https://www.openstreetmap.org/${p.osm_type}/${p.osm_id}`,
        note: "Regular weekly hours in OpenStreetMap format (\"Tu off\" = closed Tuesdays); holidays and special closures may differ, so link the user to the place's website."
      }
    }
  } catch {}
  cache.set(key, { at: Date.now(), value })
  if (cache.size > 2000) cache.delete(cache.keys().next().value!)
  return value
}
