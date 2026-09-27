// Two ranking helpers for search.ts:
//   • queryCategories: which site categories a search means ("accounting software" → software,
//     finance; "barber" → hair_beauty), so sites in those categories get a boost.
//   • mergeRegional: one result per brand — nike.com shown once, with nike.com.br / nike.co.uk
//     folded underneath as regional_sites, instead of three near-identical top results.

const CATEGORY_WORDS: [RegExp, string[]][] = [
  [/\b(restaurants?|dinner|lunch|pizza|sushi|burgers?|ramen|tapas|steak|italian|thai|indian|mexican|chinese|vegan food)\b/, ["restaurant"]],
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
  [/\b(api|sdk|hosting|database|devops|code|developer)\b/, ["developer"]],
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
