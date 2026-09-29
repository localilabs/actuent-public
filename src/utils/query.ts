// Understanding what was typed, before searching:
//   • cleanQuery: question-style searches become keywords ("where can I buy running shoes in
//     London?" → "buy running shoes london"), filler words go ("please", "the best", "find me").
//   • cacheKey: one key for searches that only differ in case, spacing or punctuation.
//   • nearMe: "near me" becomes the searcher's city (Vercel's location header), when known.
//   • wantsProducts: whether a product search is worth running at all (speed).

const LEADING = /^(please\s+)?(can you\s+|could you\s+)?(where (can|do|could|should) (i|we)|where to|how (can|do) (i|we)|what('s| is| are) (the )?(best|good)|i('m| am) looking for|i (want|need|would like)( to)?|looking for|find me|show me|get me|search for|find|recommend( me)?|tell me about|any good|good)\s+/i
const FILLER = /\b(please|thanks|thank you|some|any|a|an|the|me|my|for me|that|which|really|very|good|best|top|nice)\b/gi

export function cleanQuery(raw: string): string {
  let q = raw.trim().replace(/[?!¿¡]+/g, " ").replace(/\s+/g, " ")
  // Domains and URLs are left exactly as typed.
  if (/^\S+\.[a-z]{2,}(\/\S*)?$/i.test(q)) return q
  for (let i = 0; i < 2; i++) q = q.replace(LEADING, "")
  const words = q.split(" ")
  // Only long, question-like searches lose filler words; "the north face" stays as it is.
  // Yes/no questions lose their question words too: "does basecamp have a free plan" → "basecamp free plan".
  if (words.length >= 4) {
    q = q.replace(FILLER, " ")
    if (/^(does|do|is|are|can|could|will|has|should)\s/i.test(q)) q = q.replace(/^\S+\s+/, "").replace(/\b(have|has|there|offer|offers|it|they|you|i|we)\b/gi, " ")
  }
  // Prices are for the product search ("under 500 dkk"), not words to look for on websites.
  q = q.replace(/\b(?:under|below|less than|cheaper than|max(?:imum)?|up to|for less than)\s*[€$£]?\s*\d+(?:[.,]\d+)?\s*(eur|euros?|usd|dollars?|gbp|pounds?|kr\.?|kroner|dkk|sek|nok)?\b/gi, " ")
  q = q.replace(/\s+in\s+/gi, " ").replace(/\s+/g, " ").trim()
  return q.length >= 2 ? q : raw.trim()
}

// For the product search: the same cleaning, but "under 500 dkk" is kept.
export function cleanQueryKeepPrice(raw: string): string {
  const price = raw.match(/\b(?:under|below|less than|cheaper than|max(?:imum)?|up to|for less than)\s*[€$£]?\s*\d+(?:[.,]\d+)?\s*(eur|euros?|usd|dollars?|gbp|pounds?|kr\.?|kroner|dkk|sek|nok)?\b/i)?.[0]
  const rest = cleanQuery(raw)
  return price ? `${rest} ${price}` : rest
}

export function cacheKey(q: string): string {
  return q.toLowerCase().normalize("NFC").replace(/[\s"'“”‘’,;:]+/g, " ").replace(/[?!.]+$/g, "").trim()
}

// "coffee near me" + city "Copenhagen" → "coffee copenhagen". Vercel sets x-vercel-ip-city
// (URL-encoded) on every request; nothing is stored.
export function nearMe(q: string, cityHeader: string | undefined): string {
  if (!/\b(near me|nearby|around me|close to me)\b/i.test(q) || !cityHeader) return q
  let city = ""
  try { city = decodeURIComponent(cityHeader) } catch { city = cityHeader }
  if (!city || /[^\p{L}\s.'-]/u.test(city)) return q
  return q.replace(/\b(near me|nearby|around me|close to me)\b/i, city).replace(/\s+/g, " ").trim()
}

const NOT_SHOPPING = /\b(software|app|saas|api|hosting|news|weather|recipes?|course|courses|jobs?|dentist|doctor|lawyer|plumber|electrician|barber|hairdresser|restaurants?|cafes?|coffee shops?|bars?|pubs?|hotels?|hostels?|flights?|museums?|events?|tickets?|concerts?|near me|how to|bakery|bakeries|pizza|sushi|brunch|gyms?|spas?|salons?|pharmacy|clinic|vet|cinema|theatre|theater|nightclubs?|parks?|dinner|lunch|breakfast)\b/i
// Yes/no questions ("does basecamp have a free plan") and comparisons ("notion vs obsidian") aren't shopping.
const NOT_SHOPPING_TYPED = /^(does|do|is|are|can|could|will|has|have|should|how (to|do|does))\b|\s(vs\.?|versus)\s/i
export function wantsProducts(q: string, typed: string = q): boolean {
  return !NOT_SHOPPING.test(q) && !NOT_SHOPPING_TYPED.test(typed.trim())
}
