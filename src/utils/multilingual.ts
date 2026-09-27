// Instant multilingual keywords: common search words in European languages → the English words the
// index uses (LAWP text is English). Runs before any LLM call, so "zahnarzt berlin", "løbesko" or
// "boulangerie paris" match straight away, and still work when the LLM is slow or out of quota.
// German/Nordic/Dutch compounds are split: "laufschuhe" → lauf + schuhe → running shoes.
// The LLM expansion (search.ts expandQuery) still translates anything this doesn't know.

// English word(s) → the same word in de, fr, es, it, nl, pt, da, sv, no, pl, fi (lower case, no articles).
const CONCEPTS: Record<string, string[]> = {
  "shoes": ["schuhe", "schuh", "chaussures", "chaussure", "zapatos", "zapatillas", "scarpe", "schoenen", "sapatos", "sapatilhas", "sko", "skor", "buty", "kengät"],
  "running": ["lauf", "laufen", "course", "running", "correr", "corsa", "hardloop", "corrida", "løbe", "løbe", "löpar", "löp", "løpe", "bieganie", "juoksu"],
  "clothes": ["kleidung", "mode", "vêtements", "vetements", "ropa", "abbigliamento", "kleding", "roupa", "tøj", "kläder", "klær", "odzież", "ubrania", "vaatteet"],
  "bakery": ["bäckerei", "baeckerei", "boulangerie", "panadería", "panaderia", "panetteria", "forno", "bakkerij", "padaria", "bageri", "piekarnia", "leipomo"],
  "restaurant": ["restaurant", "restaurante", "ristorante", "trattoria", "restauracja", "ravintola", "gaststätte", "lokal"],
  "cafe": ["café", "kaffee", "cafetería", "cafeteria", "caffè", "caffe", "koffiebar", "kaffebar", "kawiarnia", "kahvila", "konditori"],
  "coffee": ["kaffee", "café", "caffè", "koffie", "kaffe", "kawa", "kahvi"],
  "pizza": ["pizzeria"],
  "bar": ["kneipe", "bistrot", "taberna", "cervecería", "osteria", "kroeg", "bodega", "pub", "baari"],
  "hotel": ["hotel", "hôtel", "albergo", "hotell", "hotelli", "unterkunft", "hébergement", "alojamiento", "alloggio", "overnachting", "alojamento", "overnatning", "boende", "overnatting", "nocleg", "majoitus"],
  "flights": ["flüge", "flug", "vols", "vol", "vuelos", "vuelo", "voli", "volo", "vluchten", "vlucht", "voos", "voo", "fly", "flyg", "loty", "lot", "lennot"],
  "cheap": ["günstig", "billig", "pas cher", "barato", "baratos", "economico", "economici", "goedkoop", "billige", "tani", "tanie", "halpa", "halvat"],
  "car rental": ["autovermietung", "mietwagen", "location de voiture", "alquiler de coches", "noleggio auto", "autoverhuur", "aluguel de carros", "aluguer de carros", "biludlejning", "biluthyrning", "bilutleie", "wynajem samochodów", "autovuokraamo"],
  "train": ["zug", "bahn", "train", "tren", "treno", "trein", "comboio", "trem", "tog", "tåg", "pociąg", "juna"],
  "dentist": ["zahnarzt", "zahnärztin", "dentiste", "dentista", "tandarts", "tandlæge", "tandläkare", "tannlege", "dentysta", "hammaslääkäri"],
  "doctor": ["arzt", "ärztin", "hausarzt", "médecin", "medecin", "médico", "medico", "dottore", "huisarts", "arts", "læge", "läkare", "lege", "lekarz", "lääkäri"],
  "pharmacy": ["apotheke", "pharmacie", "farmacia", "apotheek", "farmácia", "apotek", "apteka", "apteekki"],
  "hospital": ["krankenhaus", "klinik", "hôpital", "hopital", "clinique", "hospital", "clínica", "ospedale", "ziekenhuis", "sygehus", "hospital", "sjukhus", "sykehus", "szpital", "sairaala"],
  "vet": ["tierarzt", "vétérinaire", "veterinario", "veterinário", "dierenarts", "dyrlæge", "veterinär", "veterinær", "weterynarz", "eläinlääkäri"],
  "hairdresser": ["friseur", "friseurin", "coiffeur", "coiffure", "peluquería", "peluqueria", "parrucchiere", "kapper", "cabeleireiro", "frisør", "frisör", "fryzjer", "kampaamo"],
  "barber": ["barbier", "barbería", "barberia", "barbiere", "kapper", "barbeiro", "barber", "barberare", "barberer", "golibroda", "parturi"],
  "beauty salon": ["kosmetikstudio", "schönheitssalon", "institut de beauté", "salón de belleza", "centro estetico", "schoonheidssalon", "salão de beleza", "skønhedssalon", "skönhetssalong", "salong", "salon kosmetyczny", "kauneushoitola"],
  "gym": ["fitnessstudio", "fitness", "salle de sport", "gimnasio", "palestra", "sportschool", "ginásio", "academia", "træningscenter", "gym", "treningssenter", "siłownia", "kuntosali"],
  "lawyer": ["anwalt", "rechtsanwalt", "anwältin", "avocat", "abogado", "avvocato", "advocaat", "advogado", "advokat", "prawnik", "adwokat", "asianajaja"],
  "accountant": ["steuerberater", "buchhalter", "comptable", "expert-comptable", "contable", "contador", "commercialista", "boekhouder", "contabilista", "revisor", "bogholder", "redovisningskonsult", "regnskapsfører", "księgowy", "kirjanpitäjä"],
  "accounting": ["buchhaltung", "comptabilité", "comptabilite", "contabilidad", "contabilità", "contabilita", "boekhouding", "contabilidade", "regnskab", "bokföring", "regnskap", "księgowość", "kirjanpito"],
  "software": ["software", "logiciel", "logiciels", "programa", "programma", "programmatuur", "programvare", "oprogramowanie", "ohjelmisto", "ohjelma"],
  "app": ["app", "application", "aplicación", "applicazione", "applicatie", "aplicativo", "aplikacja", "sovellus"],
  "project management": ["projektmanagement", "gestion de projet", "gestión de proyectos", "gestione progetti", "projectbeheer", "gestão de projetos", "projektstyring", "projektledning", "prosjektstyring", "zarządzanie projektami", "projektinhallinta"],
  "payments": ["zahlungen", "zahlung", "paiement", "paiements", "pagos", "pago", "pagamenti", "pagamento", "betalingen", "betaling", "betalning", "płatności", "maksut", "maksu"],
  "bank": ["bank", "banque", "banco", "banca", "banken", "pankki"],
  "insurance": ["versicherung", "assurance", "seguro", "seguros", "assicurazione", "verzekering", "forsikring", "försäkring", "ubezpieczenie", "vakuutus"],
  "electrician": ["elektriker", "électricien", "electricista", "elettricista", "elektricien", "eletricista", "elektryk", "sähköasentaja"],
  "plumber": ["klempner", "installateur", "plombier", "fontanero", "idraulico", "loodgieter", "canalizador", "encanador", "vvs", "rørlegger", "rörmokare", "hydraulik", "putkimies"],
  "cleaning": ["reinigung", "putzfirma", "nettoyage", "ménage", "limpieza", "pulizie", "schoonmaak", "limpeza", "rengøring", "städning", "rengjøring", "sprzątanie", "siivous"],
  "moving company": ["umzug", "umzugsfirma", "déménagement", "mudanzas", "traslochi", "verhuisbedrijf", "mudanças", "flyttefirma", "flyttfirma", "przeprowadzki", "muuttopalvelu"],
  "real estate": ["immobilien", "makler", "immobilier", "inmobiliaria", "immobiliare", "makelaar", "imobiliária", "ejendomsmægler", "mäklare", "eiendomsmegler", "nieruchomości", "kiinteistö"],
  "apartment": ["wohnung", "appartement", "piso", "apartamento", "appartamento", "lejlighed", "lägenhet", "leilighet", "mieszkanie", "asunto"],
  "rent": ["mieten", "miete", "louer", "location", "alquiler", "alquilar", "affitto", "huren", "huur", "aluguel", "arrendar", "leje", "hyra", "leie", "wynajem", "vuokra"],
  "buy": ["kaufen", "acheter", "comprar", "comprare", "kopen", "købe", "köpa", "kjøpe", "kupić", "ostaa"],
  "shop": ["laden", "geschäft", "boutique", "magasin", "tienda", "negozio", "winkel", "loja", "butik", "butikk", "sklep", "kauppa"],
  "online shop": ["onlineshop", "online-shop", "boutique en ligne", "tienda online", "negozio online", "webwinkel", "loja online", "webshop", "nettbutikk", "sklep internetowy", "verkkokauppa"],
  "supermarket": ["supermarkt", "supermarché", "supermercado", "supermercato", "supermarked", "mataffär", "dagligvare", "supermarket", "ruokakauppa"],
  "groceries": ["lebensmittel", "courses", "épicerie", "comestibles", "alimentari", "boodschappen", "mercearia", "dagligvarer", "livsmedel", "spożywcze", "ruoka"],
  "flowers": ["blumen", "fleurs", "fleuriste", "flores", "floristería", "fiori", "fioraio", "bloemen", "bloemist", "florista", "blomster", "blommor", "kwiaty", "kukat"],
  "books": ["bücher", "buch", "livres", "librairie", "libros", "librería", "libri", "libreria", "boeken", "boekhandel", "livros", "livraria", "bøger", "böcker", "bøker", "książki", "kirjat"],
  "furniture": ["möbel", "meubles", "muebles", "mobili", "meubels", "móveis", "møbler", "möbler", "meble", "huonekalut"],
  "bike": ["fahrrad", "rad", "vélo", "velo", "bicicleta", "bici", "bicicletta", "fiets", "cykel", "sykkel", "rower", "pyörä"],
  "car": ["auto", "wagen", "voiture", "coche", "carro", "macchina", "bil", "samochód", "samochod", "auto"],
  "repair": ["reparatur", "werkstatt", "réparation", "reparation", "garage", "reparación", "taller", "riparazione", "officina", "reparatie", "reparação", "oficina", "reparation", "værksted", "verkstad", "verksted", "naprawa", "warsztat", "korjaamo", "korjaus"],
  "phone": ["handy", "telefon", "téléphone", "portable", "teléfono", "móvil", "movil", "telefono", "cellulare", "telefoon", "mobiel", "telefone", "telemóvel", "celular", "mobil", "puhelin"],
  "internet": ["internet", "glasfaser", "fibre", "fibra", "glasvezel", "bredbånd", "bredband", "światłowód", "laajakaista"],
  "electricity": ["strom", "électricité", "electricidad", "luce", "elettricità", "stroom", "eletricidade", "strøm", "el", "elektryczność", "sähkö"],
  "tickets": ["tickets", "karten", "billets", "billet", "entradas", "billetes", "biglietti", "kaartjes", "bilhetes", "ingressos", "billetter", "biljetter", "bilety", "liput"],
  "concert": ["konzert", "concert", "concierto", "concerto", "koncert", "konsert", "koncert", "konsertti"],
  "museum": ["museum", "musée", "musee", "museo", "museu", "muzeum", "museo", "museet"],
  "cinema": ["kino", "cinéma", "cinema", "cine", "bioscoop", "biograf", "bio", "kino", "elokuvateatteri"],
  "school": ["schule", "école", "ecole", "escuela", "colegio", "scuola", "school", "escola", "skole", "skola", "szkoła", "koulu"],
  "course": ["kurs", "kurse", "cours", "formation", "curso", "cursos", "corso", "corsi", "cursus", "kursus", "kursen", "kursy", "kurssi"],
  "language": ["sprache", "sprachkurs", "langue", "idioma", "lingua", "taal", "língua", "sprog", "språk", "język", "kieli"],
  "jobs": ["jobs", "stellen", "stellenangebote", "emploi", "offres d'emploi", "empleo", "trabajo", "lavoro", "vacatures", "emprego", "vagas", "job", "ledige stillinger", "lediga jobb", "stillinger", "praca", "työpaikat"],
  "news": ["nachrichten", "actualités", "actualites", "noticias", "notizie", "nieuws", "notícias", "nyheder", "nyheter", "wiadomości", "uutiset"],
  "weather": ["wetter", "météo", "meteo", "tiempo", "clima", "weer", "tempo", "vejret", "vejr", "väder", "været", "pogoda", "sää"],
  "recipes": ["rezepte", "rezept", "recettes", "recette", "recetas", "receta", "ricette", "ricetta", "recepten", "receitas", "opskrifter", "recept", "oppskrifter", "przepisy", "reseptit"],
  "wine": ["wein", "vin", "vino", "vinho", "wijn", "wino", "viini"],
  "beer": ["bier", "bière", "cerveza", "birra", "cerveja", "øl", "öl", "piwo", "olut"],
  "delivery": ["lieferung", "lieferdienst", "livraison", "entrega", "a domicilio", "consegna", "bezorging", "levering", "leverans", "dostawa", "toimitus"],
  "booking": ["buchen", "buchung", "réserver", "reservation", "réservation", "reservar", "reserva", "prenotare", "prenotazione", "boeken", "reservering", "booke", "bestille", "boka", "bokning", "rezerwacja", "varaus", "varata"],
  "appointment": ["termin", "rendez-vous", "cita", "appuntamento", "afspraak", "marcação", "consulta", "tid", "tidsbestilling", "tidsbokning", "time", "wizyta", "ajanvaraus"],
  "open now": ["geöffnet", "jetzt geöffnet", "ouvert", "ouvert maintenant", "abierto", "abierto ahora", "aperto", "aperto ora", "nu open", "aberto", "åben", "åbent", "öppet", "åpent", "otwarte", "auki"],
  "near": ["in der nähe", "nähe", "près de", "pres de", "à proximité", "cerca de", "cerca", "vicino", "vicino a", "in de buurt", "perto", "perto de", "i nærheden", "nära", "i nærheten", "w pobliżu", "lähellä"],
  "children": ["kinder", "kinderwagen", "enfants", "enfant", "bébé", "niños", "bebé", "bambini", "neonato", "kinderen", "crianças", "bebê", "børn", "barn", "dzieci", "lapset"],
  "baby monitor": ["babyphone", "babyfoon", "vigilabebés", "baby monitor", "babyalarm", "babyvakt", "niania elektroniczna", "itkuhälytin"],
  "toys": ["spielzeug", "jouets", "juguetes", "giocattoli", "speelgoed", "brinquedos", "legetøj", "leksaker", "leker", "zabawki", "lelut"],
  "pets": ["haustiere", "tierbedarf", "animaux", "mascotas", "animali", "huisdieren", "animais", "kæledyr", "husdjur", "kjæledyr", "zwierzęta", "lemmikit"],
  "garden": ["garten", "jardin", "jardín", "giardino", "tuin", "jardim", "have", "trädgård", "hage", "ogród", "puutarha"],
  "tools": ["werkzeug", "outils", "herramientas", "attrezzi", "utensili", "gereedschap", "ferramentas", "værktøj", "verktyg", "verktøy", "narzędzia", "työkalut"],
  "glasses": ["brille", "brillen", "optiker", "lunettes", "opticien", "gafas", "óptica", "occhiali", "ottico", "bril", "opticien", "óculos", "briller", "glasögon", "optiker", "okulary", "silmälasit"],
  "jewellery": ["schmuck", "bijoux", "bijouterie", "joyería", "joyas", "gioielli", "sieraden", "joias", "smykker", "smycken", "biżuteria", "korut"],
  "watches": ["uhren", "montres", "relojes", "orologi", "horloges", "relógios", "ure", "klockor", "klokker", "zegarki", "kellot"],
  "translation": ["übersetzung", "traduction", "traducción", "traduzione", "vertaling", "tradução", "oversættelse", "översättning", "oversettelse", "tłumaczenie", "käännös"],
  "wedding": ["hochzeit", "mariage", "boda", "matrimonio", "bruiloft", "casamento", "bryllup", "bröllop", "ślub", "häät"],
  "photographer": ["fotograf", "photographe", "fotógrafo", "fotografo", "fotograaf", "fotograf", "valokuvaaja"],
  "taxi": ["taxi", "táxi", "taksówka", "taksi"],
  "parking": ["parkplatz", "parkhaus", "parking", "stationnement", "aparcamiento", "estacionamiento", "parcheggio", "parkeren", "estacionamento", "parkering", "parkering", "parkowanie", "pysäköinti"],
  "petrol station": ["tankstelle", "station-service", "gasolinera", "benzinaio", "tankstation", "posto de gasolina", "tankstation", "bensinstation", "bensinstasjon", "stacja benzynowa", "huoltoasema"],
  "laundry": ["wäscherei", "waschsalon", "laverie", "pressing", "lavandería", "lavanderia", "wasserette", "vaskeri", "tvättomat", "pralnia", "pesula"],
  "tailor": ["schneider", "änderungsschneiderei", "retouche", "couturier", "sastre", "sarto", "kleermaker", "alfaiate", "skrædder", "skräddare", "skredder", "krawiec", "räätäli"],
  "locksmith": ["schlüsseldienst", "serrurier", "cerrajero", "fabbro", "slotenmaker", "serralheiro", "låsesmed", "låssmed", "ślusarz", "lukkoseppä"],
  "vegan": ["vegan", "végétalien", "vegano", "veganistisch", "vegansk", "wegański", "vegaani"],
  "vegetarian": ["vegetarisch", "végétarien", "vegetariano", "vegetarisk", "wegetariański", "kasvis"],
  "gluten free": ["glutenfrei", "sans gluten", "sin gluten", "senza glutine", "glutenvrij", "sem glúten", "glutenfri", "bezglutenowy", "gluteeniton"],
  "breakfast": ["frühstück", "petit-déjeuner", "petit déjeuner", "desayuno", "colazione", "ontbijt", "pequeno-almoço", "café da manhã", "morgenmad", "frukost", "frokost", "śniadanie", "aamiainen"],
  "sushi": ["sushi"],
  "italian": ["italienisch", "italien", "italienne", "italiano", "italiana", "italiaans", "italiensk", "włoska", "włoski", "italialainen"],
  "chinese": ["chinesisch", "chinois", "chinoise", "chino", "china", "cinese", "chinees", "kinesisk", "chiński", "kiinalainen"],
  "french": ["französisch", "français", "francaise", "francés", "francese", "frans", "francês", "fransk", "francuski", "ranskalainen"],
  "free": ["kostenlos", "gratis", "gratuit", "gratuito", "darmowy", "bezpłatny", "ilmainen"],
  "video calls": ["videokonferenz", "visioconférence", "videoconferencia", "videoconferenza", "videobellen", "videochamada", "videomøde", "videomöte", "wideokonferencja", "videopuhelu"],
  "email marketing": ["e-mail-marketing", "newsletter", "emailing", "marketing por correo", "email marketing", "e-mailmarketing", "nyhedsbrev", "nyhetsbrev", "mailing", "sähköpostimarkkinointi"],
  "website builder": ["homepage-baukasten", "website-baukasten", "créateur de site", "création de site", "creador de páginas web", "crea sito", "websitebouwer", "criador de sites", "hjemmesidebygger", "hemsidebyggare", "kreator stron", "kotisivukone"],
  "password manager": ["passwort-manager", "passwortmanager", "gestionnaire de mots de passe", "gestor de contraseñas", "gestore di password", "wachtwoordbeheerder", "gerenciador de senhas", "adgangskodeadministrator", "lösenordshanterare", "passordbehandler", "menedżer haseł", "salasananhallinta"],
  "music": ["musik", "musique", "música", "musica", "muziek", "muzyka", "musiikki"],
  "streaming": ["streaming", "streamen", "strømning"],
  "notes": ["notizen", "notes", "notas", "note", "notities", "noter", "anteckningar", "notatki", "muistiinpanot"],
  "design": ["gestaltung", "conception", "diseño", "progettazione", "ontwerp", "projeto", "projektowanie", "suunnittelu"],
  "holiday": ["urlaub", "ferien", "vacances", "vacaciones", "vacanze", "vakantie", "férias", "ferie", "semester", "wakacje", "loma"],
  "travel": ["reisen", "reise", "voyage", "voyages", "viajes", "viaje", "viaggi", "viaggio", "reizen", "viagens", "rejser", "resor", "reiser", "podróże", "matkat"],
  "tour": ["führung", "stadtführung", "visite guidée", "visita guiada", "visita guidata", "rondleiding", "rundvisning", "guidning", "omvisning", "wycieczka", "opastettu kierros"],
  "events": ["veranstaltungen", "événements", "evenements", "sortir", "eventos", "eventi", "evenementen", "arrangementer", "evenemang", "wydarzenia", "tapahtumat"],
  "today": ["heute", "aujourd'hui", "hoy", "oggi", "vandaag", "hoje", "i dag", "idag", "dzisiaj", "tänään"],
  "tonight": ["heute abend", "ce soir", "esta noche", "stasera", "vanavond", "hoje à noite", "i aften", "i kväll", "i kveld", "dziś wieczorem", "tänä iltana"],
  "online": ["en ligne", "en línea", "in linea", "on-line", "w sieci", "verkossa"],
  // Cities in their own language → the English name most sites use.
  "copenhagen": ["københavn", "kobenhavn", "kopenhagen", "copenhague"],
  "munich": ["münchen", "muenchen", "munique", "monaco di baviera"],
  "cologne": ["köln", "koeln"],
  "vienna": ["wien", "vienne", "viena"],
  "prague": ["praha", "prag", "praga"],
  "rome": ["roma"],
  "milan": ["milano"],
  "florence": ["firenze"],
  "venice": ["venezia"],
  "naples": ["napoli"],
  "turin": ["torino"],
  "lisbon": ["lisboa", "lissabon", "lisbonne"],
  "warsaw": ["warszawa", "warschau", "varsovie"],
  "krakow": ["kraków"],
  "gothenburg": ["göteborg", "goteborg"],
  "brussels": ["bruxelles", "brussel", "brüssel"],
  "antwerp": ["antwerpen", "anvers"],
  "the hague": ["den haag"],
  "geneva": ["genève", "genf", "ginevra"],
  "zurich": ["zürich", "zuerich"],
  "seville": ["sevilla"],
  "athens": ["athína", "athen", "athènes", "atenas"],
  "london": ["londres", "londra", "londen"],
  "paris": ["parigi", "parijs"],
  "berlin": ["berlino", "berlijn"],
  "helsinki": ["helsingfors"],
  "cheap hotel": ["hostel", "auberge", "albergue", "ostello", "herberg", "vandrerhjem", "vandrarhem", "schronisko", "retkeilymaja"]
}

// Words that only appear in non-English text: their presence means the query needs translating.
const FOREIGN_STOPWORDS = new Set(("der das und für mit bei im in der nähe nach von zum zur ein eine günstig " +
  "le la les des du et pour avec près chez une aux sur " +
  "el los las y para con cerca del una unos " +
  "il lo gli di per vicino una " +
  "het een voor bij naar " +
  "o os as do da dos das com perto para " +
  "og med ved af på nær " +
  "och för med vid av på nära ett " +
  "dla blisko " +
  "sekä lähellä").split(/\s+/).filter(w => w && !["in", "a", "i", "o", "e", "de", "en", "da", "do", "to", "on", "the", "for", "and", "near", "with", "at", "by"].includes(w)))

// Everyday English words that also appear above; they never count as foreign on their own.
const ENGLISH_WORDS = new Set(("mode location arts have time garage pressing courses course note notes formation bio lot fly pub tempo " +
  "boutique bank mailing newsletter hostel internet fitness gym app application bar design streaming auto car school hotel museum " +
  "cinema concert tickets taxi parking vegan sushi pizza restaurant cafe software events tour travel music jobs job running tid bil " +
  "el cine forno arts kino deli cafeteria salon installateur record sport gratis fiets rad online webshop shop mobil").split(" "))

const LOOKUP = new Map<string, string>()
for (const [english, words] of Object.entries(CONCEPTS)) for (const w of words) if (!LOOKUP.has(w)) LOOKUP.set(w, english)
// Phrases (two or more words) are matched before single words.
const PHRASES = [...LOOKUP.keys()].filter(k => k.includes(" ")).sort((a, b) => b.length - a.length)
const ENGLISH = new Set(Object.keys(CONCEPTS).flatMap(k => k.split(" ")))

function norm(s: string): string {
  return s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim()
}

// "laufschuhe" → ["running", "shoes"]; "løbesko" → ["running", "shoes"]. Split points need 3+ letters each side.
function splitCompound(word: string): string[] | null {
  if (word.length < 7 || word.length > 40) return null
  for (let i = word.length - 3; i >= 3; i--) {
    const tail = LOOKUP.get(word.slice(i))
    if (!tail) continue
    const head = word.slice(0, i).replace(/s$|-$|e$/, "")
    const headEnglish = LOOKUP.get(word.slice(0, i)) || LOOKUP.get(head)
    return headEnglish ? [headEnglish, tail] : [tail]
  }
  return null
}

// Rewrites a query's non-English words into English: "zahnarzt berlin" → "dentist berlin",
// "restaurante italiano cerca de mi" → "restaurant italian near". Place names and unknown words stay.
// `english` lists just the translated keywords; `foreign` says the query looks non-English, so the
// search waits for the full LLM translation instead of trusting the plain results.
export function translateKeywords(query: string): { query: string, english: string[], foreign: boolean } {
  let q = norm(query).slice(0, 300)
  const found: string[] = []
  const out: string[] = []
  let foreign = /[à-öø-ÿąćęłńśźżœ]/i.test(q)
  for (const phrase of PHRASES) {
    const at = q.indexOf(phrase)
    if (at >= 0 && (at === 0 || q[at - 1] === " ") && (at + phrase.length === q.length || q[at + phrase.length] === " ")) {
      found.push(LOOKUP.get(phrase)!)
      q = (q.slice(0, at) + " \u0000" + found.length + " " + q.slice(at + phrase.length)).trim()
      foreign = true
    }
  }
  for (const word of q.split(/[\s,]+/).filter(Boolean)) {
    if (word.startsWith("\u0000")) { out.push(found[Number(word.slice(1)) - 1]); continue }
    if (ENGLISH_WORDS.has(word)) { out.push(word); continue }
    if (FOREIGN_STOPWORDS.has(word)) { foreign = true; continue }
    const direct = LOOKUP.get(word)
    // Words that are also English ("hotel", "taxi", "museum") don't make a query foreign.
    if (direct && (ENGLISH.has(word) || direct === word)) { out.push(word); continue }
    if (direct) { found.push(direct); out.push(direct); foreign = true; continue }
    const parts = splitCompound(word)
    if (parts) { const e = parts.join(" "); found.push(e); out.push(e); foreign = true; continue }
    out.push(word)
  }
  // Leftover one- and two-letter words in a foreign query are articles and prepositions ("de", "mi").
  const rewritten = (foreign ? out.filter(w => w.length > 2 || /\d/.test(w)) : out).join(" ")
  const english = [...new Set(found)].filter(e => !norm(query).split(" ").includes(e))
  return { query: foreign && english.length ? rewritten : query, english, foreign }
}

// The query's language from its small words, when clear ("wo kann ich …" → de). Used to rank sites
// in the searcher's own language a little higher. null for English or when unsure.
const LANG_WORDS: Record<string, string[]> = {
  de: ["der", "die", "das", "und", "für", "mit", "ich", "wo", "kann", "nähe", "günstig", "kaufen", "beste", "nicht", "ein", "eine", "im", "zum", "zur"],
  fr: ["le", "la", "les", "des", "du", "et", "pour", "avec", "près", "chez", "pas", "cher", "meilleur", "acheter", "où", "une", "un", "au", "aux"],
  es: ["el", "los", "las", "del", "y", "para", "con", "cerca", "barato", "comprar", "mejor", "dónde", "donde", "una", "unos"],
  it: ["il", "lo", "gli", "di", "per", "con", "vicino", "economico", "comprare", "migliore", "dove", "una", "della", "delle"],
  nl: ["het", "een", "van", "voor", "met", "bij", "goedkoop", "kopen", "beste", "waar", "naar"],
  pt: ["os", "as", "do", "da", "dos", "das", "para", "com", "perto", "barato", "comprar", "melhor", "onde", "uma"],
  da: ["og", "til", "med", "ved", "af", "på", "billig", "billige", "købe", "bedste", "hvor", "nær", "en", "et"],
  sv: ["och", "för", "med", "vid", "av", "på", "billig", "billiga", "köpa", "bästa", "var", "nära", "ett"],
  no: ["og", "til", "med", "ved", "av", "på", "billig", "kjøpe", "beste", "hvor", "nær", "et"],
  pl: ["w", "z", "na", "do", "dla", "tani", "kupić", "najlepszy", "gdzie", "blisko"]
}
export function queryLanguage(query: string): string | null {
  const words = query.toLowerCase().split(/\s+/)
  const hasLetters = (re: RegExp) => re.test(query.toLowerCase())
  let best: string | null = null, top = 0
  for (const [lang, list] of Object.entries(LANG_WORDS)) {
    let n = words.filter(w => list.includes(w)).length
    if (lang === "de" && hasLetters(/[äöüß]/)) n += 1
    if (lang === "da" && hasLetters(/[æø]/)) n += 1
    if ((lang === "sv") && hasLetters(/[åä]/) && !hasLetters(/[æø]/)) n += 0.5
    if (lang === "fr" && hasLetters(/[éèêàç]/)) n += 0.5
    if (lang === "es" && hasLetters(/[ñ¿¡]/)) n += 1
    if (lang === "pl" && hasLetters(/[ąćęłńśźż]/)) n += 1
    if (n > top) { top = n; best = lang }
  }
  return top >= 1 ? best : null
}
