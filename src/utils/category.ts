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
  ["restaurant", ["restaurant", "dinner", "lunch menu", "reserve a table", "book a table", "cuisine", "tasting menu", "trattoria", "bistro", "pizzeria", "sushi"]],
  ["food_delivery", ["food delivery", "order food", "takeaway", "meal kit"]],
  ["hotel", ["hotel", "rooms", "check-in", "suites", "bed and breakfast", "hostel", "vacation rental", "stay with us"]],
  ["travel", ["flights", "travel", "tours", "holiday", "vacation", "itinerary", "cruise", "car rental"]],
  ["events", ["tickets", "concert", "festival", "cinema", "theatre", "theater", "live music", "comedy show"]],
  ["museum_culture", ["museum", "gallery", "exhibition", "collection"]],
  ["ai", ["ai assistant", "artificial intelligence", "llm", "generative ai", "chatbot", "ai-powered", "machine learning"]],
  ["developer", ["api", "sdk", "developers", "open source", "open-source", "github", "documentation", "cli", "deploy", "hosting", "devops", "automation", "kubernetes", "infrastructure", "server hosting", "terraform"]],
  ["software", ["saas", "software", "app", "platform", "free trial", "dashboard", "integrations", "workflow", "sign up", "pricing plans"]],
  ["shop_fashion", ["clothing", "dresses", "sneakers", "shoes", "jackets", "fashion", "apparel", "jewelry", "jewellery", "handbags"]],
  ["shop_beauty", ["skincare", "makeup", "cosmetics", "fragrance", "serum", "moisturizer"]],
  ["shop_electronics", ["electronics", "laptops", "smartphones", "headphones", "cameras", "gadgets", "smart home"]],
  ["shop_home", ["furniture", "sofas", "home decor", "bedding", "kitchenware", "lighting", "rugs"]],
  ["shop_sports", ["outdoor gear", "cycling", "running gear", "camping", "ski", "fishing", "sportswear"]],
  ["shop_kids", ["baby", "kids", "toys", "nursery", "toddler"]],
  ["shop_grocery", ["groceries", "wine shop", "coffee beans", "tea shop", "organic food", "chocolate"]],
  ["pets", ["pet", "dog", "cat food", "grooming", "veterinary"]],
  ["shop", ["shop", "store", "add to cart", "free shipping", "checkout", "buy now", "products", "collections"]],
  ["news_media", ["news", "breaking", "journalism", "newsletter", "podcast", "magazine", "editorial"]],
  ["education", ["courses", "university", "school", "students", "tutoring", "online course", "curriculum", "research", "scientists", "academic"]],
  ["finance", ["bank", "banking", "loans", "insurance", "invest", "mortgage", "credit card", "accounting", "crypto"]],
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
  if (!pages.trim() || /^website at /.test(pages.trim())) return null

  let best: string | null = null, bestScore = 0
  for (const [cat, words] of WORDS) {
    let score = 0
    for (const w of words) score += count(pages, w) + count(name, w) * 2 + count(actions, w) * 0.5
    if (score < (GENERIC.has(cat) ? 3 : 2)) continue
    // Earlier (more specific) categories win ties.
    if (score > bestScore) { best = cat; bestScore = score }
  }
  return best
}
