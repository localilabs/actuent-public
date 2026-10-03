import { CITY_NAMES } from "./local"
import { typos } from "./brand"

// Fast spelling fixes for the words that decide a search: cities, kinds of places, event words and
// everyday product words ("cofee in seatle" → "coffee in seattle", "consert in new york" → "concert…").
// No database, so it works on slow nights too. Only near-misses are fixed: one typing mistake for
// words of 4–6 letters, two for longer ones, and never a word that's already a known word.

const WORDS = (
  "coffee cafe cafes restaurant restaurants bar bars pub pubs bakery bakeries brunch breakfast lunch dinner pizza pizzeria burger burgers " +
  "sushi tacos taco ramen noodles thai indian mexican chinese italian vegan vegetarian seafood steak dessert icecream gelato donuts bagels " +
  "concert concerts comedy theatre theater museum museums gallery festival festivals tickets weekend tonight tomorrow cinema movies " +
  "hotel hotels hostel apartment flights barber hairdresser dentist doctor pharmacy gym yoga massage spa salon nails " +
  "shoes sneakers trainers running boots jacket jackets headphones earbuds laptop laptops phone phones camera watch watches backpack " +
  "furniture sofa chair desk mattress bicycle bike cheapest cheap best open near manager password software marketing email " +
  "project management accounting website builder hosting analytics streaming delivery groceries supermarket pharmacy " +
  "toronto copenhagen"
).split(" ")

const KNOWN = new Set<string>([...WORDS, ...CITY_NAMES.flatMap(c => c.split(" "))].filter(w => w.length >= 3))
const CITY_WORDS = CITY_NAMES.filter(c => !c.includes(" "))

// Short everyday words that look like typos of known words but aren't ("bare" ≠ "bar").
const LEAVE = new Set(["near", "best", "open", "free", "plan", "plans", "with", "from", "that", "this", "what", "when", "where", "does", "have",
  "cost", "buy", "shop", "food", "good", "late", "now", "today", "show", "shows", "tour", "live", "music", "bare", "card", "cards", "post", "rest", "list"])

// Short city names people type ("what's on in cph today", "pizza nyc").
const SHORT_CITIES: [RegExp, string][] = [[/\b(cph|kbh)\b/gi, "copenhagen"], [/\bnyc\b/gi, "new york"], [/\b(in|near) (la)\b/gi, "$1 los angeles"], [/\b(in|near) (sf)\b/gi, "$1 san francisco"], [/\b(in|near) (dc)\b/gi, "$1 washington"], [/\bldn\b/gi, "london"], [/\bsthlm\b/gi, "stockholm"]]

export function fixSpelling(query: string): string | null {
  const short = SHORT_CITIES.reduce((q, [re, to]) => q.replace(re, to), query)
  const parts = short.split(/(\s+)/)
  let changed = short !== query
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i], w = raw.toLowerCase().replace(/[?!.,]+$/, "")
    if (w.length < 4 || /[^a-zæøåäöüé'-]/.test(w) || KNOWN.has(w) || LEAVE.has(w)) continue
    // Accents aren't typos ("cafés" is "cafes").
    const plain = w.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    if (KNOWN.has(plain) || KNOWN.has(plain.replace(/s$/, "")) || KNOWN.has(plain.replace(/es$/, ""))) continue
    // City names only where a place is expected ("in seatle"), never a brand ("nike" isn't Nice).
    const afterPlaceWord = /^(in|near|at|around)$/i.test((parts[i - 2] || "").trim())
    // A plural of a known word is fine ("tickets", "cafés").
    if (KNOWN.has(w.replace(/e?s$/, "")) || KNOWN.has(w.replace(/'s$/, ""))) continue
    // Two mistakes only in long words, and the first letter must match ("bickett" isn't "tickets").
    const allowed = w.length >= 8 ? 2 : 1
    let best: string | null = null, bestD = allowed + 1
    for (const k of afterPlaceWord ? [...CITY_WORDS, ...WORDS] : WORDS) {
      if (Math.abs(k.length - w.length) > allowed || k[0] !== w[0]) continue
      const d = typos(w, k)
      if (d < bestD) { best = k; bestD = d }
    }
    if (best && bestD <= allowed) { parts[i] = raw.replace(new RegExp(w, "i"), best); changed = true }
  }
  return changed ? parts.join("") : null
}
