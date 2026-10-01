// Does a product actually match the search? The product index finds anything sharing a single word
// with the search, so "nike shoes" found Nike golf putters and "veggie restaurants" found veggie
// magnesium pills. A product is only shown when every important word of the search is in its name:
// the brand and the thing. Words match in their common forms and languages ("shoes" = sneakers,
// trainers, sko, Schuhe…), and plurals/simple endings are ignored.

// Words that say nothing about which product it is.
const FILLER = new Set(["a", "an", "the", "for", "with", "and", "or", "of", "in", "on", "to", "from", "at", "by", "my", "me", "i",
  "buy", "best", "cheap", "cheapest", "lowest", "billigste", "billigast", "günstigste", "goedkoopste", "economico", "good", "top", "new", "sale", "online", "shop", "shops", "store", "stores", "price", "prices",
  "deal", "deals", "discount", "order", "get", "find", "where", "can", "which", "what", "want", "need", "looking", "some", "any",
  "men", "mens", "women", "womens", "kids", "unisex", "size", "near", "delivery", "free", "shipping", "official", "original", "genuine",
  "køb", "billig", "billige", "bedste", "kaufen", "günstig", "acheter", "comprar", "barato", "comprare", "kopen", "köpa", "kjøpe"])

// Things and their other names (English forms, and the same thing in the languages shops use most).
const SAME_THING: string[][] = [
  ["shoe", "sneaker", "trainer", "footwear", "sko", "skor", "schuh", "schuhe", "løbesko", "löparsko", "hardloopschoen", "chaussure", "zapato", "zapatilla", "scarpa", "scarpe", "schoen", "kenkä", "sportsko", "løbesko", "laufschuh"],
  ["boot", "støvle", "stövel", "stiefel", "botte", "bota", "stivale", "laars"],
  ["sandal", "flip flop", "slide", "sandale", "sandalia"],
  ["shirt", "tee", "t shirt", "tshirt", "top", "trøje", "tröja", "hemd", "chemise", "camiseta", "maglia"],
  ["jacket", "coat", "parka", "jakke", "jacka", "jacke", "veste", "chaqueta", "giacca", "jas"],
  ["trouser", "pant", "jean", "legging", "bukser", "byxor", "hose", "pantalon", "pantalón", "pantaloni", "broek"],
  ["hoodie", "sweatshirt", "sweater", "jumper", "pullover", "hættetrøje", "sweat"],
  ["dress", "kjole", "klänning", "kleid", "robe", "vestido", "vestito", "jurk"],
  ["bag", "backpack", "rucksack", "tote", "taske", "väska", "tasche", "sac", "bolso", "borsa", "tas", "rygsæk"],
  ["tumbler", "quencher", "insulated cup", "travel mug", "termokrus", "thermobecher"],
  ["watch", "smartwatch", "ur", "klocka", "uhr", "montre", "reloj", "orologio", "horloge"],
  ["headphone", "earphone", "earbud", "headset", "høretelefon", "hörlurar", "kopfhörer", "casque", "auricular", "cuffie", "airpod"],
  ["phone", "smartphone", "iphone", "mobil", "handy", "téléphone", "telefono", "móvil"],
  ["laptop", "notebook", "macbook", "bærbar", "ordinateur portable", "portátil"],
  ["bike", "bicycle", "cykel", "fahrrad", "vélo", "bicicleta", "bicicletta", "fiets"],
  ["coffee", "espresso", "kaffe", "kaffee", "café", "caffè", "koffie", "bean"],
  ["tea", "te", "tee", "thé", "té", "thee"],
  ["chair", "stol", "stuhl", "chaise", "silla", "sedia", "stoel"],
  ["sofa", "couch", "sofá", "divano", "bank"],
  ["lamp", "light", "lampe", "lampa", "lámpara", "lampada"],
  ["cream", "creme", "crème", "crema", "lotion", "moisturiser", "moisturizer"],
  ["perfume", "fragrance", "parfum", "parfume", "eau de toilette", "eau de parfum", "profumo"],
  ["supplement", "vitamin", "capsule", "tablet", "pill", "kosttilskud"],
  ["toy", "legetøj", "leksak", "spielzeug", "jouet", "juguete", "giocattolo", "speelgoed"],
  ["book", "bog", "bok", "buch", "livre", "libro", "boek"],
  // Compound words ("løbesko" = running shoes) count for both parts.
  ["running", "run", "løb", "löpning", "laufen", "course", "correr", "corsa", "hardlopen", "jogging", "løbesko", "laufschuh", "löparsko", "hardloopschoen", "runner"],
]

// Model names that are a kind of thing, one way only: "shoes" finds a Pegasus 41 (its name may not
// say "shoe"), but "pegasus" finds only Pegasus, never an Air Force 1.
const MODELS: Record<string, string[]> = {
  shoe: ["air max", "air force", "jordan", "pegasus", "vomero", "dunk", "boost", "ultraboost", "gel", "clifton", "bondi", "ghost", "cloud", "novablast", "kayano", "nimbus", "samba", "gazelle", "stan smith", "550", "990", "chuck taylor"],
  headphone: ["airpods", "wh 1000xm5", "wh 1000xm4", "quietcomfort", "bose qc"]
}

// A simple stem: lowercase, no accents, no plural or common ending.
export function stem(word: string): string {
  let w = word.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  if (w.length > 3) w = w.replace(/ies$/, "y").replace(/(ss|x|z|ch|sh)es$/, "$1").replace(/([^s])s$/, "$1")
  if (w.length > 5) w = w.replace(/(ing|er|en|e)$/, "")
  return w
}

const FORMS = new Map<string, string[]>()
for (const group of SAME_THING) {
  const stems = group.map(g => g.split(" ").map(stem).join(" "))
  for (const s of stems) FORMS.set(s, [...new Set([...(FORMS.get(s) || []), ...stems])])
}

const words = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[\p{L}\p{N}]+/gu) || []

// The words a product has to match: everything but filler and numbers.
export function importantWords(query: string): string[] {
  return [...new Set(words(query).filter(w => !FILLER.has(w) && !/^\d+$/.test(w) && w.length > 1))]
}

// Kids' and pet products only when the search asks for them: "shoes" means shoes for the person
// asking, not "Little Kids" trainers or paw-print slippers.
const KIDS = /\b(kids?|little kids|big kids|toddlers?|baby|babies|infants?|junior|jr|youth|boys?|girls?|children|child|b[øo]rn|kinder|enfants?|niños?|bambin[io]|peuter|småbørn)\b|\b\d{1,2}\s?(?:-\s?\d{1,2}\s?)?(?:y|yrs|years?|år|jahre|ans)\b/i
// Kids-only brands and shops: their products are for children even when the name doesn't say so
// (Reima's "Hallava" is a kids' winter boot).
const KIDS_BRANDS = /\b(reima|polarn o\.? pyret|molo|name it|mini rodini|liewood|konges sl[oø]jd|joha|en fant|hust (and|&) claire|petit bateau|bobo choses|kavat|bundgaard|viking kids|pomp(d|de)elux|lindberg sweden|didriksons kids|tretorn kids|melton|smallstuff|sebra|carter'?s|oshkosh|gap kids|h&m kids)\b/i
const KIDS_SHOPS = /(^|\.)(reima\.(com|dk|se|fi)|polarnopyret\.(com|dk|se|no)|molo\.(com|dk)|minirodini\.com|liewood\.com|kongesslojd\.(com|dk)|babysam\.dk|jollyroom\.(dk|se|no)|kidsbrandstore\.(com|dk|se)|kidsworld\.dk|br\.dk|pompdelux\.(com|dk)|smallable\.com|bundgaard\.dk|kavat\.(com|se)|carters\.com|oshkosh\.com)$/i
export function isKids(row: { name: string, domain?: string }): boolean {
  return KIDS.test(row.name) || KIDS_BRANDS.test(row.name) || (!!row.domain && KIDS_SHOPS.test(row.domain))
}
const PETS = /\b(dogs?|cats?|pets?|puppy|puppies|kitten|paw|hund|kat|katze|chien|chat|perro|gato|cane|gatto)\b/i

// How well a matching product fits: lower for kids'/pet items the search didn't ask for, for
// sold-out ones and ones without a picture.
export function productFit(query: string, row: { name: string, domain?: string, available?: boolean | null, image?: string | null, price_eur?: number | string | null }): number {
  let fit = 1
  // Shop quality: a price agents can compare, and a sensible name (not a keyword-stuffed one).
  if (row.price_eur == null) fit *= 0.6
  if (row.name.length > 120) fit *= 0.8
  if (isKids(row) && !KIDS.test(query)) fit *= 0.2
  if (PETS.test(row.name) && !PETS.test(query)) fit *= 0.1
  if (row.available === false) fit *= 0.3
  if (!row.image) fit *= 0.7
  // Model numbers ("pegasus 41", "iphone 15"): the exact model first, the 42 after it.
  const numbers = (query.match(/\b\d{1,4}\b/g) || []).filter(n => !/\b(under|below|over|max|size|str)\s*$/i.test(query.slice(0, query.indexOf(n))))
  if (numbers.length && !numbers.every(n => new RegExp(`\\b${n}\\b`).test(row.name))) fit *= 0.5
  return fit
}

// Best fit first, keeping the search order within a fit, and at most `perShop` from one shop until
// every shop has had its turn (so one shop's catalogue doesn't fill the list).
export function rankProducts<T extends { name: string, domain: string, available?: boolean | null, image?: string | null, price_eur?: number | string | null }>(query: string, rows: T[], perShop = 2): T[] {
  // Kids'/pet items the search didn't ask for are dropped (fit 0.2 / 0.1), not just moved down.
  const scored = rows.map((row, i) => ({ row, fit: productFit(query, row), i })).filter(x => x.fit >= 0.25)
  scored.sort((a, b) => b.fit - a.fit || a.i - b.i)
  const count = new Map<string, number>(), first: T[] = [], rest: T[] = []
  for (const { row } of scored) {
    const n = count.get(row.domain) || 0
    ;(n < perShop ? first : rest).push(row)
    count.set(row.domain, n + 1)
  }
  return [...first, ...rest]
}

export function productMatches(query: string, productName: string): boolean {
  const need = importantWords(query)
  if (!need.length) return false
  const nameWords = words(productName)
  const nameStems = new Set(nameWords.map(stem))
  const stemmedName = " " + nameWords.map(stem).join(" ") + " "
  return need.every(w => {
    const s = stem(w)
    const forms = FORMS.get(s) || [s]
    // The thing's model names count too ("shoe" → Pegasus), when the search word is that kind of thing.
    const kind = Object.keys(MODELS).find(k => forms.includes(stem(k)))
    const options = [...forms, ...(kind ? MODELS[kind].map(m => m.split(" ").map(stem).join(" ")) : [])]
    return options.some(o => o.includes(" ") ? stemmedName.includes(` ${o} `) : nameStems.has(o))
  })
}

// "cheapest trainers", "billigste løbesko": sort by price instead of relevance.
export const WANTS_CHEAPEST = /\b(cheapest|lowest price|best price|billigste|billigast|günstigste|moins cher|más barato|più economico|goedkoopste)\b/i

// Other ways to say a search, for "nothing found" answers: the everyday English word for each thing
// ("løbesko" → "running shoe"), and the search without its last word.
export function alternativeSearches(query: string): string[] {
  const ws = words(query), out: string[] = []
  const swapped = ws.map(w => {
    const group = SAME_THING.find(g => g.some(x => stem(x) === stem(w)))
    return group && stem(group[0]) !== stem(w) ? group[0] : w
  }).join(" ")
  if (swapped !== ws.join(" ")) out.push(swapped)
  if (ws.length > 2) out.push(ws.slice(0, -1).join(" "))
  return [...new Set(out)].filter(x => x && x !== query.toLowerCase().trim())
}

// A broad one-word search ("shoes"): the first results cover different kinds (running, everyday,
// boots…) instead of five of one kind, so the user (or their AI) can say which they meant.
const KINDS: Record<string, [string, RegExp][]> = {
  shoe: [["running", /\b(run|running|løbe|lauf|trail|marathon)/i], ["everyday", /\b(sneaker|trainer|street|casual|canvas|low top|high top|air force|stan smith)/i], ["boots", /\b(boot|støvle|stiefel|chelsea)/i],
    ["smart", /\b(oxford|loafer|derby|brogue|dress shoe|pump|heel)/i], ["sport", /\b(padel|tennis|court|football|basketball|golf|indoor)/i], ["outdoor", /\b(hiking|hike|walking|trek|outdoor)/i], ["sandals", /\b(sandal|slide|flip)/i]],
  jacket: [["rain", /\b(rain|regn|waterproof|shell)/i], ["warm", /\b(puffer|down|parka|winter|dun)/i], ["leather", /\b(leather|læder)/i], ["denim", /\b(denim|jean)/i], ["light", /\b(bomber|overshirt|windbreaker|light)/i]],
  headphone: [["over-ear", /\b(over-ear|over ear|headphones?)\b/i], ["earbuds", /\b(earbud|in-ear|in ear|airpods?|buds)/i], ["sport", /\b(sport|running|open-ear|bone)/i]],
  bag: [["backpack", /\b(backpack|rucksack|rygsæk)/i], ["tote", /\b(tote|shopper)/i], ["crossbody", /\b(crossbody|shoulder|sling)/i], ["travel", /\b(travel|duffel|weekend|suitcase)/i]]
}
export function spreadKinds<T extends { name: string }>(query: string, rows: T[]): T[] {
  const w = importantWords(query)
  if (w.length !== 1) return rows
  const kinds = KINDS[stem(w[0])]
  if (!kinds) return rows
  const buckets = new Map<string, T[]>(), rest: T[] = []
  for (const r of rows) { const k = kinds.find(([, re]) => re.test(r.name)); if (k) { if (!buckets.has(k[0])) buckets.set(k[0], []); buckets.get(k[0])!.push(r) } else rest.push(r) }
  const out: T[] = []
  // One of each kind (in the order they first appear), then the rest in their original order.
  for (const list of buckets.values()) out.push(list.shift()!)
  const seen = new Set(out)
  return [...out, ...rows.filter(r => !seen.has(r))]
}
