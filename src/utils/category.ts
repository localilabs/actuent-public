// Site categories, rule-based (no LLM): from the schema.org business type first, then words in
// the site's name, pages and actions. Used for directory pages, competitor views and filters.
// Copied from actuent-crawler/category.ts — keep in sync.

export const CATEGORIES: Record<string, string> = {
  restaurant: "Restaurants", cafe: "Cafés", bar: "Bars & pubs", bakery: "Bakeries", food_delivery: "Food delivery",
  hair_beauty: "Hair & beauty", spa_wellness: "Spas & wellness", fitness: "Gyms & fitness", health: "Health & clinics", dental: "Dentists",
  hotel: "Hotels & stays", travel: "Travel", events: "Events & entertainment", museum_culture: "Museums & culture",
  shop_fashion: "Fashion & clothing", shop_beauty: "Beauty products", shop_electronics: "Electronics", shop_home: "Home & furniture",
  shop_grocery: "Food & drink shops", shop_sports: "Sports & outdoors", shop_kids: "Kids & baby", shop: "Online shops",
  software: "Software & apps", developer: "Developer tools", ai: "AI tools", news_media: "News & media", education: "Education",
  finance: "Finance", real_estate: "Real estate", legal: "Legal", automotive: "Cars & automotive", home_services: "Home services",
  pets: "Pets", jobs: "Jobs & careers", nonprofit: "Nonprofits", government: "Government", social: "Social & communities",
  games: "Games", streaming: "Music & video",
  adult: "Adult", gambling: "Gambling"
}

// Kept out of directories and competitor lists.
export const HIDDEN_CATEGORIES = new Set(["adult", "gambling"])

// schema.org @type → category
const TYPES: [RegExp, string][] = [
  [/^(Restaurant|FastFoodRestaurant|FoodEstablishment)$/, "restaurant"], [/^CafeOrCoffeeShop$/, "cafe"], [/^(BarOrPub|Winery|Brewery|Distillery|NightClub)$/, "bar"],
  [/^Bakery$/, "bakery"], [/^(HairSalon|BeautySalon|NailSalon|HealthAndBeautyBusiness)$/, "hair_beauty"], [/^(DaySpa|TattooParlor)$/, "spa_wellness"],
  [/^(ExerciseGym|SportsActivityLocation|SportsClub|HealthClub)$/, "fitness"], [/^Dentist$/, "dental"],
  [/^(MedicalBusiness|MedicalClinic|Physician|Hospital|Pharmacy|Optician|Physiotherapy|VeterinaryCare)$/, "health"],
  [/^(Hotel|LodgingBusiness|BedAndBreakfast|Hostel|Motel|Resort|Campground)$/, "hotel"], [/^(TravelAgency|TouristAttraction)$/, "travel"],
  [/^(EntertainmentBusiness|MovieTheater|Casino|AmusementPark|EventVenue)$/, "events"], [/^(Museum|ArtGallery|Library)$/, "museum_culture"],
  [/^(ClothingStore|ShoeStore|JewelryStore)$/, "shop_fashion"], [/^(ElectronicsStore|ComputerStore|MobilePhoneStore)$/, "shop_electronics"],
  [/^(FurnitureStore|HomeGoodsStore|HardwareStore|GardenStore)$/, "shop_home"], [/^(GroceryStore|LiquorStore|ConvenienceStore)$/, "shop_grocery"],
  [/^(SportingGoodsStore|BikeStore)$/, "shop_sports"], [/^(Store|OnlineStore|ShoppingCenter|OnlineBusiness)$/, "shop"],
  [/^(RealEstateAgent)$/, "real_estate"], [/^(LegalService|Attorney|Notary)$/, "legal"], [/^(FinancialService|BankOrCreditUnion|InsuranceAgency|AccountingService)$/, "finance"],
  [/^(AutoRepair|AutoDealer|AutomotiveBusiness|AutoRental|GasStation)$/, "automotive"],
  [/^(HomeAndConstructionBusiness|Plumber|Electrician|HVACBusiness|Locksmith|RoofingContractor|HousePainter|MovingCompany|GeneralContractor)$/, "home_services"],
  [/^(EducationalOrganization|School|CollegeOrUniversity|Preschool)$/, "education"], [/^(NGO)$/, "nonprofit"], [/^(GovernmentOrganization|GovernmentOffice)$/, "government"],
  [/^(PetStore)$/, "pets"], [/^(NewsMediaOrganization)$/, "news_media"]
]

// Words in the site's text → category, most specific first. Page text counts 1, the site's name 2
// and action phrases 0.5 (rule-based actions like "Shop products" are too common to lead).
// Specific categories need a score of 2, broad ones (GENERIC) 3.
const GENERIC = new Set(["shop", "software", "developer", "social", "jobs", "news_media", "education"])
const WORDS: [string, string[]][] = [
  ["adult", ["porn", "xxx", "sex cams", "nsfw", "adult videos", "escort", "onlyfans"]],
  ["gambling", ["casino", "slot online", "slots", "sports betting", "betting", "poker", "togel", "judi", "bookmaker", "jackpot"]],
  ["dental", ["dentist", "dental", "orthodontist", "teeth whitening", "tandlæge"]],
  ["hair_beauty", ["barber", "barbershop", "hair salon", "hairdresser", "haircut", "nail salon", "manicure", "lashes", "brows", "frisør"]],
  ["spa_wellness", ["spa", "massage", "wellness", "sauna", "yoga studio", "meditation"]],
  ["fitness", ["gym", "fitness", "personal trainer", "crossfit", "pilates", "workout", "membership plans"]],
  ["health", ["clinic", "doctor", "physiotherapy", "therapist", "pharmacy", "medical", "patients", "veterinary", "optician", "mental health", "adhd", "symptoms", "treatment", "health"]],
  ["bakery", ["bakery", "bakehouse", "sourdough", "pastries", "bageri"]],
  ["cafe", ["cafe", "café", "coffee shop", "espresso", "brunch", "roastery"]],
  ["bar", ["cocktail bar", "wine bar", "pub", "brewery", "taproom", "craft beer", "bar menu"]],
  ["restaurant", ["restaurant", "dinner", "lunch menu", "reserve a table", "book a table", "cuisine", "tasting menu", "trattoria", "bistro", "pizzeria", "pizza", "sushi", "burger", "kebab", "ramen", "grill", "steakhouse", "tapas", "thai food", "indian food",
    "ristorante", "restaurante", "speisekarte", "carte du jour", "menukort", "bord reservation", "tisch reservieren"]],
  ["food_delivery", ["food delivery", "order food", "takeaway", "meal kit"]],
  ["hotel", ["hotel", "rooms", "check-in", "suites", "bed and breakfast", "hostel", "vacation rental", "stay with us", "hôtel", "albergo", "unterkunft", "overnatning"]],
  ["travel", ["flights", "travel", "tours", "holiday", "vacation", "itinerary", "cruise", "car rental"]],
  ["events", ["tickets", "concert", "festival", "cinema", "theatre", "theater", "live music", "comedy show"]],
  ["museum_culture", ["museum", "gallery", "exhibition", "collection"]],
  ["games", ["video games", "gaming", "game studio", "play now", "multiplayer", "esports", "steam", "playstation", "xbox", "nintendo", "mmorpg", "online games"]],
  ["streaming", ["music streaming", "streaming service", "watch online", "tv shows", "movies online", "podcasts", "playlists", "listen now", "stream music", "anime"]],
  ["ai", ["ai assistant", "artificial intelligence", "llm", "generative ai", "chatbot", "ai-powered", "machine learning"]],
  ["developer", ["api", "sdk", "developers", "open source", "open-source", "github", "documentation", "cli", "deploy", "hosting", "devops", "automation", "kubernetes", "infrastructure", "server hosting", "terraform"]],
  ["software", ["saas", "software", "app", "platform", "free trial", "dashboard", "integrations", "workflow", "sign up", "pricing plans",
    "email marketing", "newsletter tool", "project management", "crm", "invoicing", "accounting software", "video conferencing", "video calls",
    "password manager", "website builder", "note taking", "collaboration", "productivity", "analytics", "for teams", "customer support software",
    "helpdesk", "scheduling", "online forms", "e-signature", "vpn", "antivirus", "cybersecurity", "cloud storage", "team chat",
    "marketing platform", "sms marketing", "campaigns", "automations", "video communication", "meetings", "webinars", "collaboration tools", "tools for businesses", "all-in-one"]],
  ["shop_fashion", ["clothing", "dresses", "sneakers", "shoes", "jackets", "fashion", "apparel", "jewelry", "jewellery", "handbags"]],
  ["shop_beauty", ["skincare", "makeup", "cosmetics", "fragrance", "serum", "moisturizer"]],
  ["shop_electronics", ["electronics", "laptops", "smartphones", "headphones", "cameras", "gadgets", "smart home"]],
  ["shop_home", ["furniture", "sofas", "home decor", "bedding", "kitchenware", "lighting", "rugs"]],
  ["shop_sports", ["outdoor gear", "cycling", "running gear", "camping", "ski", "fishing", "sportswear"]],
  ["shop_kids", ["baby", "kids", "toys", "nursery", "toddler"]],
  ["shop_grocery", ["groceries", "wine shop", "coffee beans", "tea shop", "organic food", "chocolate"]],
  ["pets", ["pet", "dog", "cat food", "grooming", "veterinary"]],
  ["shop", ["shop", "store", "add to cart", "free shipping", "checkout", "buy now", "products", "collections", "online shop", "webshop",
    "warenkorb", "panier", "carrito", "carrello", "winkelwagen", "kurv", "varukorg", "handlekurv", "koszyk", "gratis fragt", "livraison gratuite", "versandkostenfrei", "envío gratis"]],
  ["news_media", ["news", "breaking", "journalism", "newsletter", "podcast", "magazine", "editorial", "nachrichten", "actualités", "noticias", "notizie", "nyheder", "nyheter", "nieuws", "headlines", "latest stories"]],
  ["education", ["courses", "university", "school", "students", "tutoring", "online course", "curriculum", "research", "scientists", "academic"]],
  ["finance", ["bank", "banking", "loans", "insurance", "invest", "mortgage", "credit card", "accounting", "crypto", "payments", "payment processing",
    "online payments", "trading", "stocks", "exchange rates", "money transfer", "wallet", "fintech", "bookkeeping", "tax", "pension"]],
  ["real_estate", ["real estate", "property", "apartments for rent", "homes for sale", "realtor", "estate agent"]],
  ["legal", ["lawyer", "attorney", "law firm", "legal advice", "solicitor"]],
  ["automotive", ["car dealer", "auto repair", "car service", "used cars", "tyres", "tires", "garage", "automobile", "motorcycle", "vehicles"]],
  ["home_services", ["plumber", "electrician", "cleaning service", "roofing", "renovation", "moving company", "handyman"]],
  ["jobs", ["jobs", "careers", "hiring", "job board", "recruitment", "resume"]],
  ["nonprofit", ["donate", "charity", "nonprofit", "non-profit", "volunteer", "foundation"]],
  ["social", ["community", "forum", "social network", "members", "discussions"]]
]

function count(text: string, word: string): number {
  const re = new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "g")
  return (text.match(re) || []).length
}

export function categorize(site: { domain: string, name?: string, pages?: any, actions?: any[], business?: any }): string | null {
  const type = String(site.business?.type || "")
  for (const [re, cat] of TYPES) if (re.test(type)) return cat
  if (/\.gov(\.[a-z]{2})?$|\.gouv\.|\.gv\.at$/.test(site.domain)) return "government"
  if (/\.edu$|\.ac\.[a-z]{2}$/.test(site.domain)) return "education"

  const name = String(site.name || "").toLowerCase()
  const pages = Object.values(site.pages || {}).map((p: any) => `${p?.title || ""} ${p?.content || ""}`).join(" ").toLowerCase()
  const actions = (site.actions || []).map((a: any) => `${a?.name || ""} ${a?.description || ""} ${(a?.intent || []).join(" ")}`).join(" ").toLowerCase()
  // Strong signals first: what the site lets you do, and what its domain says.
  const ids = (site.actions || []).map((a: any) => String(a?.id || "")).join(" ")
  const bare = site.domain.toLowerCase().replace(/^www\./, "")
  if (/\.(shop|store|boutique)$/.test(bare) || /\b(view_cart|add_to_cart|checkout)\b/.test(ids)) {
    const fashion = /cloth|fashion|shoe|sneaker|wear|apparel|jewel/.test(name + " " + pages) ? "shop_fashion" : null
    if (fashion) return fashion
  }
  if (/\.(bank|insurance)$/.test(bare)) return "finance"
  if (/\.(news)$/.test(bare)) return "news_media"
  if (/\.(museum|art)$/.test(bare)) return "museum_culture"
  if (/\.(games|game)$/.test(bare)) return "games"
  if (!pages.trim() || /^website at /.test(pages.trim())) {
    // Nothing to read: fall back on the domain's own words ("pizza-roma.dk", "cph-barber.com").
    const words = bare.replace(/\.[a-z.]+$/, "").replace(/[-_.]/g, " ")
    for (const [cat, list] of WORDS) if (!GENERIC.has(cat) && list.some(w => w.length >= 4 && !w.includes(" ") && words.includes(w))) return cat
    return null
  }

  // Short texts (most rule-based summaries) need fewer mentions to count.
  const short = pages.length < 400
  let best: string | null = null, bestScore = 0
  for (const [cat, words] of WORDS) {
    let score = 0
    for (const w of words) score += count(pages, w) + count(name, w) * 2 + count(actions, w) * 0.5 + (bare.includes(w.replace(/\s+/g, "")) && w.length >= 4 ? 1 : 0)
    if (score < (GENERIC.has(cat) ? (short ? 2 : 3) : (short ? 1 : 2))) continue
    // Earlier (more specific) categories win ties.
    if (score > bestScore) { best = cat; bestScore = score }
  }
  return best
}
