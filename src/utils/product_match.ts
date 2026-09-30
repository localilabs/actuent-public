// Does a product actually match the search? The product index finds anything sharing a single word
// with the search, so "nike shoes" found Nike golf putters and "veggie restaurants" found veggie
// magnesium pills. A product is only shown when every important word of the search is in its name:
// the brand and the thing. Words match in their common forms and languages ("shoes" = sneakers,
// trainers, sko, Schuhe…), and plurals/simple endings are ignored.

// Words that say nothing about which product it is.
const FILLER = new Set(["a", "an", "the", "for", "with", "and", "or", "of", "in", "on", "to", "from", "at", "by", "my", "me", "i",
  "buy", "best", "cheap", "cheapest", "good", "top", "new", "sale", "online", "shop", "shops", "store", "stores", "price", "prices",
  "deal", "deals", "discount", "order", "get", "find", "where", "can", "which", "what", "want", "need", "looking", "some", "any",
  "men", "mens", "women", "womens", "kids", "unisex", "size", "near", "delivery", "free", "shipping", "official", "original", "genuine",
  "køb", "billig", "billige", "bedste", "kaufen", "günstig", "acheter", "comprar", "barato", "comprare", "kopen", "köpa", "kjøpe"])

// Things and their other names (English forms, and the same thing in the languages shops use most).
const SAME_THING: string[][] = [
  ["shoe", "sneaker", "trainer", "footwear", "sko", "skor", "schuh", "schuhe", "løbesko", "löparsko", "hardloopschoen", "chaussure", "zapato", "zapatilla", "scarpa", "scarpe", "schoen", "kenkä", "sportsko", "løbesko", "laufschuh", "air max", "air force", "jordan", "pegasus", "vomero", "dunk", "boost", "ultraboost", "gel"],
  ["boot", "støvle", "stövel", "stiefel", "botte", "bota", "stivale", "laars"],
  ["sandal", "flip flop", "slide", "sandale", "sandalia"],
  ["shirt", "tee", "t shirt", "tshirt", "top", "trøje", "tröja", "hemd", "chemise", "camiseta", "maglia"],
  ["jacket", "coat", "parka", "jakke", "jacka", "jacke", "veste", "chaqueta", "giacca", "jas"],
  ["trouser", "pant", "jean", "legging", "bukser", "byxor", "hose", "pantalon", "pantalón", "pantaloni", "broek"],
  ["hoodie", "sweatshirt", "sweater", "jumper", "pullover", "hættetrøje", "sweat"],
  ["dress", "kjole", "klänning", "kleid", "robe", "vestido", "vestito", "jurk"],
  ["bag", "backpack", "rucksack", "tote", "taske", "väska", "tasche", "sac", "bolso", "borsa", "tas", "rygsæk"],
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

export function productMatches(query: string, productName: string): boolean {
  const need = importantWords(query)
  if (!need.length) return false
  const nameWords = words(productName)
  const nameStems = new Set(nameWords.map(stem))
  const stemmedName = " " + nameWords.map(stem).join(" ") + " "
  return need.every(w => {
    const s = stem(w)
    const options = FORMS.get(s) || [s]
    return options.some(o => o.includes(" ") ? stemmedName.includes(` ${o} `) : nameStems.has(o))
  })
}
