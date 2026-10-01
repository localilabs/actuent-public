// Two ranking helpers for search.ts:
//   • queryCategories: which site categories a search means ("accounting software" → software,
//     finance; "barber" → hair_beauty), so sites in those categories get a boost.
//   • mergeRegional: one result per brand — nike.com shown once, with nike.com.br / nike.co.uk
//     folded underneath as regional_sites, instead of three near-identical top results.

const CATEGORY_WORDS: [RegExp, string[]][] = [
  [/\b(restaurants?|dinner|lunch|pizza|sushi|burgers?|ramen|tapas|steak|italian|thai|indian|mexican|chinese|vegan food|tacos?|burritos?|bbq|barbecue|pho|dumplings?|noodles?|seafood|oysters?|falafel|kebabs?|fried chicken|wings|bagels?|deli|dim sum|curry|poke|brunch|diner)\b/, ["restaurant"]],
  [/\b(cafes?|coffee|espresso|roaster(y|ies)|brunch)\b/, ["cafe"]],
  [/\b(bars?|pubs?|cocktails?|wine bar|brewery)\b/, ["bar"]],
  [/\b(bakery|bakeries|bread|pastry|pastries)\b/, ["bakery"]],
  [/\b(hotels?|hostels?|accommodation|places? to stay|b&b|bed and breakfast|hotel booking)\b/, ["hotel", "travel"]],
  [/\b(flights?|airlines?|holidays?|vacations?|trips?|travel)\b/, ["travel"]],
  [/\b(barbers?|barbershop|haircuts?|hairdressers?|hair salon|nails?|manicure|beauty salon|lashes|brows)\b/, ["hair_beauty"]],
  [/\b(spa|massage|wellness|sauna)\b/, ["spa_wellness"]],
  [/\b(gyms?|fitness|yoga|pilates|crossfit|personal trainer)\b/, ["fitness"]],
  [/\b(dentists?|dental|orthodontist)\b/, ["dental"]],
  [/\b(doctors?|clinic|gp|physio|pharmacy|therapist|health)\b/, ["health"]],
  [/\b(museums?|galler(y|ies)|exhibitions?|theatre|theater)\b/, ["museum_culture", "events"]],
  [/\b(concerts?|events?|festivals?|tickets?|gigs?)\b/, ["events"]],
  [/\b(shoes|sneakers|trainers|boots|clothes|clothing|fashion|jackets?|dress(es)?|jeans|t-shirts?|hoodies?)\b/, ["shop_fashion", "shop_sports", "shop"]],
  [/\b(skincare|makeup|cosmetics|perfume)\b/, ["shop_beauty"]],
  [/\b(laptops?|phones?|headphones|electronics|tv|camera|monitors?)\b/, ["shop_electronics"]],
  [/\b(furniture|sofa|decor|kitchen|bedding)\b/, ["shop_home"]],
  [/\b(groceries|grocery|supermarket)\b/, ["shop_grocery"]],
  [/\b(pets?|dog food|cat food)\b/, ["pets"]],
  [/\b(food delivery|takeaway|take-away)\b/, ["food_delivery"]],
  [/\b(software|app|saas|crm|project management|note taking|password manager|website builder|email marketing|video conferencing|online store platform|design tool)\b/, ["software", "developer", "ai"]],
  [/\b(accounting|bookkeeping|invoic(e|es|ing)|payroll|payments?|banking|bank|budgeting|tax)\b/, ["finance", "software"]],
  [/\b(api|sdk|hosting|database|devops|code|developer|cloud|domain names?|vpn|servers?)\b/, ["developer", "software"]],
  [/\b(ai|chatbot|llm|gpt)\b/, ["ai"]],
  [/\b(news|newspaper|headlines)\b/, ["news_media"]],
  [/\b(courses?|learn|learning|school|university|tutoring)\b/, ["education"]],
  [/\b(apartments?|rent|real estate|property|homes for sale)\b/, ["real_estate"]],
  [/\b(lawyers?|legal|solicitor|attorney)\b/, ["legal"]],
  [/\b(cars?|car rental|mechanic|car repair|tyres?|tires?)\b/, ["automotive"]],
  [/\b(plumbers?|electricians?|cleaners?|cleaning|movers|removals|handyman|locksmith)\b/, ["home_services"]],
  [/\b(jobs?|careers?|hiring|vacancies)\b/, ["jobs"]]
]

export function queryCategories(query: string): Set<string> {
  const q = query.toLowerCase()
  const out = new Set<string>()
  for (const [re, cats] of CATEGORY_WORDS) if (re.test(q)) cats.forEach(c => out.add(c))
  return out
}

// "nike.com.br" → "nike": the brand label when the rest is a (country) domain ending.
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "ne", "or"])
function brandOf(domain: string): string | null {
  if (domain.includes("/")) return null
  const parts = domain.toLowerCase().replace(/^www\./, "").split(".")
  if (parts.length === 2) return parts[0]
  if (parts.length === 3 && SECOND_LEVEL.has(parts[1]) && parts[2].length === 2) return parts[0]
  return null
}

export function mergeRegional<T extends { domain: string }>(results: T[]): (T & { regional_sites?: string[] })[] {
  const byBrand = new Map<string, T & { regional_sites?: string[] }>()
  const out: (T & { regional_sites?: string[] })[] = []
  for (const r of results) {
    const brand = brandOf(r.domain)
    const first = brand ? byBrand.get(brand) : undefined
    // Same brand only when the names agree too (mail.com and mail.ru are different companies).
    const word = (x: any) => String(x?.name || "").toLowerCase().match(/[a-z0-9]+/)?.[0] || ""
    if (first && word(first) === word(r)) {
      // The .com (the global site) leads the group, in the group's position.
      if (r.domain.endsWith(".com") && !first.domain.endsWith(".com")) {
        const others = [first.domain, ...(first.regional_sites || [])]
        const i = out.indexOf(first)
        const lead = { ...r, regional_sites: others } as T & { regional_sites?: string[] }
        out[i] = lead; byBrand.set(brand!, lead)
      } else (first.regional_sites ||= []).push(r.domain)
      continue
    }
    if (first) { out.push({ ...r }); continue }
    const copy = { ...r } as T & { regional_sites?: string[] }
    if (brand) byBrand.set(brand, copy)
    out.push(copy)
  }
  return out
}

// ----- Intent: what the searcher wants to do -----
// "buy running shoes" → sites where you can buy; "book a table" → sites with booking; "near me" →
// places with directions or store finders; "how to" → help and guide pages.
const INTENTS: [RegExp, RegExp][] = [
  [/\b(buy|order|shop|purchase|price|prices|cheap|deal|deals|sale|under [€$£]?\d+)\b/i, /\b(cart|shop|buy|order|checkout|store|products?|view_cart|add_to_cart)\b/i],
  [/\b(book|booking|reserve|reservation|appointment|table for|tickets?)\b/i, /\b(book|booking|reserve|reservation|appointment|schedule|tickets?)\b/i],
  [/\b(near me|nearby|near|closest|open now|directions)\b/i, /\b(directions|find_store|store_locator|locations?|map|visit|call)\b/i],
  [/\b(how to|how do i|guide|tutorial|help with|docs|documentation)\b/i, /\b(help|docs|guide|support|learn|tutorial|faq)\b/i]
]
export function intentBoost(query: string, site: { actions?: any[], pages?: Record<string, any> }): number {
  for (const [q, has] of INTENTS) {
    if (!q.test(query)) continue
    const text = [...(site.actions || []).map(a => `${a.id} ${a.name} ${(a.intent || []).join(" ")}`), ...Object.keys(site.pages || {})].join(" ")
    return has.test(text) ? 1.2 : 1
  }
  return 1
}

// ----- Freshness for time-sensitive searches -----
const TIMELY = /\b(news|today|tonight|this week(end)?|latest|live|events?|concerts?|deals?|sale|prices?|open now|schedule|fixtures|scores?)\b/i
export function freshnessBoost(query: string, updatedAt?: string | null): number {
  if (!TIMELY.test(query) || !updatedAt) return 1
  const days = (Date.now() - Date.parse(updatedAt)) / 86400000
  return days <= 7 ? 1.15 : days <= 30 ? 1.05 : days > 180 ? 0.9 : 1
}

// ----- Quality: thin and keyword-stuffed sites rank lower -----
export function qualityFactor(site: { domain: string, pages?: Record<string, any>, actions?: any[] }): number {
  const home = String(site.pages?.["/"]?.content || Object.values(site.pages || {})[0]?.content || "")
  let f = 1
  if (home.length < 60 || /^Website at /.test(home)) f *= 0.7
  const words = home.toLowerCase().match(/[a-z]{3,}/g) || []
  if (words.length >= 30) {
    const counts = new Map<string, number>()
    for (const w of words) counts.set(w, (counts.get(w) || 0) + 1)
    const top = Math.max(...counts.values())
    if (top / words.length > 0.12) f *= 0.6 // one word repeated over and over
  }
  if ((site.domain.split("/")[0].match(/-/g) || []).length >= 3) f *= 0.8 // keyword-stuffed domains
  if (!(site.actions || []).length) f *= 0.85
  return f
}

// ----- Page answers: "basecamp pricing" → basecamp.com/pricing first -----
export function pageAnswerFirst<T extends { domain: string, name?: string }>(results: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  if (words.length < 2) return results
  const i = results.findIndex(r => {
    if (!r.domain.includes("/")) return false
    const [host, ...rest] = r.domain.toLowerCase().split("/")
    const brand = host.replace(/^www\./, "").split(".")[0]
    const path = rest.join("/") + " " + String(r.name || "").toLowerCase()
    return words.includes(brand) && words.some(w => w !== brand && path.includes(w))
  })
  if (i <= 0) return results
  return [results[i], ...results.slice(0, i), ...results.slice(i + 1)]
}

// ----- Diversity: no near-identical results in a row -----
// At most one extra page per site, and results with the same name (different domains) move down.
export function diversify<T extends { domain: string, name?: string }>(results: T[]): T[] {
  const pagesPerHost = new Map<string, number>()
  const names = new Set<string>()
  const top: T[] = [], later: T[] = []
  for (const r of results) {
    const host = r.domain.split("/")[0]
    if (r.domain.includes("/")) {
      const n = pagesPerHost.get(host) || 0
      pagesPerHost.set(host, n + 1)
      if (n >= 1) { later.push(r); continue }
    }
    const name = String(r.name || "").toLowerCase().trim()
    if (name && name.length > 3 && names.has(name) && !r.domain.includes("/")) { later.push(r); continue }
    if (name) names.add(name)
    top.push(r)
  }
  return [...top, ...later]
}

// ----- Same meaning, different words -----
// Without waiting for the LLM: "bicycle shop" finds bike shops, "car hire" finds car rental.
// Used for ranking (a synonym counts as the word) and in the fast lookup of well-known sites.
const SYNONYM_GROUPS: string[][] = [
  ["bike", "bicycle", "cycling", "cycle"], ["sneaker", "trainer"], ["shop", "store"], ["flight", "airline"],
  ["car rental", "car hire", "rent a car"], ["hotel", "accommodation"], ["laptop", "notebook"], ["phone", "smartphone", "mobile phone"],
  ["tv", "television"], ["sofa", "couch"], ["apartment", "flat"], ["film", "movie"], ["holiday", "vacation"],
  ["lawyer", "attorney", "solicitor"], ["doctor", "physician", "gp"], ["food delivery", "takeaway"], ["course", "class"],
  ["job", "career", "vacancy"], ["cinema", "movie theater"], ["pharmacy", "chemist", "drugstore"], ["hairdresser", "hair salon"],
  ["email marketing", "newsletter"], ["video conferencing", "video call", "online meeting"], ["website builder", "site builder"]
]
const SYNONYMS = new Map<string, string[]>()
for (const group of SYNONYM_GROUPS) for (const w of group) SYNONYMS.set(w, group.filter(x => x !== w))

// The other words for a (stemmed) word: "bicycle" → ["bike", "cycling", "cycle"].
export function synonymsOf(word: string): string[] {
  return SYNONYMS.get(word) || SYNONYMS.get(word.replace(/s$/, "")) || []
}

// The search with synonyms swapped in, at most 3 versions: "bicycle shop berlin" → "bike shop berlin", …
export function synonymVariants(query: string): string[] {
  const q = query.toLowerCase()
  const out: string[] = []
  // Phrases first ("car hire"), then single words.
  for (const [w, others] of [...SYNONYMS.entries()].sort((a, b) => b[0].length - a[0].length)) {
    const re = new RegExp(`\\b${w}s?\\b`)
    if (!re.test(q)) continue
    for (const o of others) if (out.length < 3) out.push(q.replace(re, o))
    break
  }
  return out
}
