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
  if (words.length >= 4) q = q.replace(FILLER, " ")
  q = q.replace(/\s+in\s+/gi, " ").replace(/\s+/g, " ").trim()
  return q.length >= 2 ? q : raw.trim()
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

const NOT_SHOPPING = /\b(software|app|saas|api|hosting|news|weather|recipes?|course|courses|jobs?|dentist|doctor|lawyer|plumber|electrician|barber|hairdresser|restaurant|cafe|bar|hotel|flights?|museum|events?|tickets?|concerts?|near me|how to)\b/i
export function wantsProducts(q: string): boolean {
  return !NOT_SHOPPING.test(q)
}
