import { fetchPublic } from "./safe-fetch"
import { robotsAllows, USER_AGENT } from "./robots"
import { cleanPageText } from "./boilerplate"
import { extractBusiness, extractEvents, openNow, todayHours } from "./business"
import { decodeEntities } from "./products"

// Read any public web page, live, for an AI assistant: "what does this page say", "what's the price on
// this link", "what's on at this venue". Returns the page as structured data instead of raw HTML:
// clean text, products with prices and stock (Shopify product pages also get cart links per variant),
// events, the business with today's hours, recipe, FAQ and article details, and the page's main links.
// robots.txt is respected; only public hosts are fetched. Every page read is saved to the index
// (lawp_pages, and the site is queued for a full crawl when Actuent doesn't know it yet), so the next
// person asking gets it from the index straight away.

const SUPABASE_URL = process.env.SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": KEY, "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" }

const text = (v: any) => decodeEntities(String(v ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
const one = (v: any) => Array.isArray(v) ? v[0] : v

function jsonLd(html: string): any[] {
  const out: any[] = []
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const d = JSON.parse(m[1].trim())
      const list = Array.isArray(d) ? d : d?.["@graph"] ? d["@graph"] : [d]
      out.push(...list.filter((x: any) => x && typeof x === "object"))
    } catch {}
  }
  return out
}
const typeOf = (x: any) => [].concat(x?.["@type"] || []).map(String)

function products(items: any[], pageUrl: string) {
  return items.filter(x => typeOf(x).includes("Product")).slice(0, 10).map(p => {
    const offers = [].concat(p.offers?.offers || p.offers || []) as any[]
    const o = offers[0] || {}
    const price = Number(o.price ?? o.lowPrice)
    return {
      name: text(p.name), brand: text(one(p.brand)?.name || p.brand) || undefined,
      price: Number.isFinite(price) ? price : null, currency: o.priceCurrency || null,
      in_stock: o.availability ? /InStock|LimitedAvailability|PreOrder/i.test(String(o.availability)) : null,
      ...(offers.length > 1 ? { offers: offers.length } : {}),
      ...(p.aggregateRating ? { rating: Number(p.aggregateRating.ratingValue) || null, reviews: Number(p.aggregateRating.reviewCount || p.aggregateRating.ratingCount) || null } : {}),
      gtin: p.gtin13 || p.gtin12 || p.gtin || undefined, url: o.url || p.url || pageUrl
    }
  }).filter(p => p.name)
}

function recipe(items: any[]) {
  const r = items.find(x => typeOf(x).includes("Recipe"))
  if (!r) return undefined
  return {
    name: text(r.name), total_time: r.totalTime || undefined, servings: text(one(r.recipeYield)) || undefined,
    ingredients: [].concat(r.recipeIngredient || []).slice(0, 40).map(text),
    steps: [].concat(r.recipeInstructions || []).slice(0, 30).map((s: any) => text(s?.text || s)).filter(Boolean)
  }
}

function faq(items: any[]) {
  const f = items.find(x => typeOf(x).includes("FAQPage"))
  const qs = [].concat(f?.mainEntity || []).slice(0, 15) as any[]
  return qs.length ? qs.map(q => ({ question: text(q.name), answer: text(q.acceptedAnswer?.text).slice(0, 600) })) : undefined
}

function article(items: any[]) {
  const a = items.find(x => typeOf(x).some(t => /Article|BlogPosting|NewsArticle/.test(t)))
  return a ? { headline: text(a.headline), author: text(one(a.author)?.name || a.author) || undefined, published: a.datePublished || undefined, updated: a.dateModified || undefined } : undefined
}

// The page's main links (navigation-like), so the assistant can go one step further.
function links(html: string, base: URL) {
  const seen = new Set<string>(), out: { text: string, url: string }[] = []
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html
  for (const m of main.matchAll(/<a\s[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL
    try { u = new URL(decodeEntities(m[1]), base) } catch { continue }
    const label = text(m[2])
    if (!/^https?:$/.test(u.protocol) || label.length < 3 || label.length > 80 || seen.has(u.href)) continue
    seen.add(u.href)
    out.push({ text: label, url: u.href })
    if (out.length >= 25) break
  }
  return out
}

// What a person can do on the page, as actions an assistant can prepare (the user confirms or finishes):
// booking widgets with their direct link, contact and sign-up forms with their fields, call, email, map.
const BOOKING: [RegExp, string][] = [
  [/https?:\/\/(?:www\.)?opentable\.[a-z.]+\/(?:r\/|restref\/|booking\/)[^"'\s<>]+/i, "OpenTable"], [/https?:\/\/(?:www\.)?resy\.com\/cities\/[^"'\s<>]+/i, "Resy"],
  [/https?:\/\/(?:www\.)?exploretock\.com\/[^"'\s<>]+/i, "Tock"], [/https?:\/\/(?:www\.)?sevenrooms\.com\/reservations\/[^"'\s<>]+/i, "SevenRooms"],
  [/https?:\/\/(?:book\.)?dinesuperb\.com\/[^"'\s<>]+|https?:\/\/(?:www\.)?dinnerbooking\.com\/[^"'\s<>]+/i, "table booking"], [/https?:\/\/calendly\.com\/[^"'\s<>]+/i, "Calendly"],
  [/https?:\/\/(?:www\.)?booksy\.com\/[^"'\s<>]+/i, "Booksy"], [/https?:\/\/(?:www\.)?fresha\.com\/[^"'\s<>]+/i, "Fresha"], [/https?:\/\/[a-z0-9-]+\.simplybook\.[a-z.]+[^"'\s<>]*/i, "SimplyBook"]
]
function actions(html: string, base: URL) {
  const out: any[] = [], seen = new Set<string>()
  const add = (a: any) => { if (!seen.has(a.url || a.type)) { seen.add(a.url || a.type); out.push(a) } }
  for (const [re, provider] of BOOKING) {
    const m = html.match(re)
    if (m) add({ type: "book", provider, name: `Book via ${provider}`, url: decodeEntities(m[0]).replace(/["'].*$/, ""), how: "Open the link; the date, time and party size are chosen there." })
  }
  for (const f of html.match(/<form[\s\S]*?<\/form>/gi) || []) {
    const fields = [...f.matchAll(/<(?:input|textarea|select)[^>]*name=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]).filter(n => !/^(_|csrf|token|nonce|g-recaptcha|honeypot|website_url)/i.test(n)).slice(0, 12)
    const action = f.match(/action=["']([^"']*)["']/i)?.[1]
    const kind = /search/i.test(f.match(/<form[^>]*>/i)?.[0] || "") || fields.length === 1 && /^(q|s|search|query)$/i.test(fields[0]) ? null
      : fields.some(n => /message|comment|enquiry|inquiry|besked/i.test(n)) ? "contact" : fields.some(n => /mail/i.test(n)) && fields.length <= 3 ? "subscribe" : null
    if (kind) add({ type: kind, name: kind === "contact" ? "Send a message (contact form)" : "Sign up (newsletter)", url: base.href, fields, ...(action ? { form_action: (() => { try { return new URL(decodeEntities(action), base).href } catch { return undefined } })() } : {}), how: "Fill in the form on the page; prepare the text with the user first." })
  }
  const tel = html.match(/href=["']tel:([^"']+)["']/i)?.[1]
  if (tel) add({ type: "call", name: "Call", phone: decodeURIComponent(tel).trim(), url: `tel:${tel.trim()}` })
  const mail = html.match(/href=["']mailto:([^"'?]+)/i)?.[1]
  if (mail) add({ type: "email", name: "Email", email: decodeURIComponent(mail).trim(), url: `mailto:${mail.trim()}` })
  const buy = html.match(/<(?:button|input)[^>]*(?:name=["']add["']|add-to-cart|addtocart|AddToCart)[^>]*>/i)
  if (buy) add({ type: "buy", name: "Add to cart", url: base.href, how: "Pick the options on the page (or use a variant's cart_url when listed)." })
  return out
}

// Shopify product pages publish /products/<handle>.js with every variant: each gets a cart link that
// opens the shop's cart with that size or colour already in it.
async function shopifyVariants(url: URL, html: string) {
  if (!/\/products\/[^/?#]+/.test(url.pathname) || !/cdn\.shopify\.com|Shopify\.shop|shopify-section/i.test(html)) return undefined
  const path = url.pathname.match(/^(.*\/products\/[^/?#]+)/)![1]
  const r = await fetchPublic(`${url.origin}${path}.js`, { headers: { "User-Agent": USER_AGENT, "Accept": "application/json" }, signal: AbortSignal.timeout(6000) }).catch(() => null)
  const p: any = r?.ok ? await r.json().catch(() => null) : null
  if (!Array.isArray(p?.variants)) return undefined
  return {
    name: text(p.title), brand: text(p.vendor) || undefined, price: Number(p.price) / 100,
    variants: p.variants.slice(0, 30).map((v: any) => ({
      name: text(v.title), price: Number(v.price) / 100, in_stock: v.available !== false,
      cart_url: `${url.origin}/cart/${v.id}:1`, id: v.id
    }))
  }
}

// "Is it in stock in a store near me?": Shopify shops with physical stores show store pickup on the
// product page, from /variants/<id>/?section_id=pickup-availability (the same request the page
// itself makes in a browser). Each store and whether that size or colour can be picked up there.
async function storePickup(origin: string, variantId: number | string): Promise<{ store: string, available: boolean, note?: string }[] | undefined> {
  const r = await fetchPublic(`${origin}/variants/${variantId}/?section_id=pickup-availability`, { headers: { "User-Agent": USER_AGENT, "Accept": "text/html" }, signal: AbortSignal.timeout(3000) }).catch(() => null)
  if (!r?.ok) return undefined
  const html = (await r.text().catch(() => "")).slice(0, 200_000)
  if (!/pickup/i.test(html)) return undefined
  const stores: { store: string, available: boolean, note?: string }[] = []
  // Most themes: one list item per store, with the store's name in a heading and a status line.
  for (const item of html.split(/<li[^>]*pickup-availability-list__item[^>]*>/i).slice(1)) {
    const name = text((item.match(/<h[2-6][^>]*>([\s\S]*?)<\/h[2-6]>/i) || [])[1] || "")
    const status = text((item.match(/<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || "")
    if (name) stores.push({ store: name.slice(0, 80), available: !/unavailable|not available|ikke tilgængelig|nicht verfügbar/i.test(status), ...(status ? { note: status.slice(0, 80) } : {}) })
  }
  // Themes without the list: the one-line summary ("Pickup available at Brooklyn").
  if (!stores.length) {
    const t = text(html)
    const at = t.match(/pickup (currently )?(un)?available at ([^.]{2,60})/i)
    if (at) stores.push({ store: at[3].trim(), available: !at[2] })
  }
  return stores.length ? stores.slice(0, 15) : undefined
}

// Saved for the next person: the page, and the site queued for a full crawl if it's new to Actuent.
// Links people paste can be private (password resets, order and account pages, links with tokens):
// those are read for the user but never saved.
const PRIVATE = /token|key=|sig=|signature|session|reset|password|passwd|auth|login|logout|account|order|checkout|cart|invoice|receipt|unsubscribe|confirm|verify|invite|share|private|secret|\/me\b|\/my\b|profile|inbox|dashboard/i
async function remember(url: URL, title: string, content: string) {
  if (!SUPABASE_URL || !KEY) return
  if (url.search || PRIVATE.test(url.pathname) || url.username || url.password) return
  const domain = url.hostname.replace(/^www\./, "")
  const path = url.pathname
  await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/lawp_pages?on_conflict=full_url`, {
      method: "POST", headers: { ...HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ domain, path, full_url: `${domain}${path}`, title: title.slice(0, 200), content: content.slice(0, 3000), actions: [], updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(4000)
    }).catch(() => null),
    (async () => {
      const known = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=domain&domain=eq.${encodeURIComponent(domain)}`, { headers: HEADERS, signal: AbortSignal.timeout(3000) }).then(r => r.ok ? r.json() : [{}]).catch(() => [{}])
      if (!known.length) await fetch(`${SUPABASE_URL}/rest/v1/crawl_queue?on_conflict=domain`, { method: "POST", headers: { ...HEADERS, "Prefer": "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ domain, requested_at: new Date().toISOString() }), signal: AbortSignal.timeout(3000) }).catch(() => null)
    })()
  ])
}

export async function readPage(raw: string, opts: { size?: string } = {}): Promise<{ ok: boolean, status: number, body: any }> {
  let url: URL
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) } catch { return { ok: false, status: 400, body: { error: "That isn't a web address" } } }
  if (!/^https?:$/.test(url.protocol)) return { ok: false, status: 400, body: { error: "Only http(s) pages" } }
  if (!await robotsAllows(url.hostname, url.pathname)) return { ok: false, status: 200, body: { url: url.href, readable: false, reason: "The site's robots.txt asks bots not to read this page, so Actuent doesn't. Link the user to it instead." } }
  const r = await fetchPublic(url.href, { headers: { "User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.8" }, signal: AbortSignal.timeout(12000) }).catch(() => null)
  if (!r) return { ok: false, status: 200, body: { url: url.href, readable: false, reason: "The page couldn't be reached (it may be down, or not public)." } }
  if (!r.ok) return { ok: false, status: 200, body: { url: url.href, readable: false, reason: `The page answered with an error (HTTP ${r.status}).` } }
  const type = r.headers.get("content-type") || ""
  if (!/html|xml/.test(type)) return { ok: false, status: 200, body: { url: url.href, readable: false, reason: `It's not a web page (${type.split(";")[0] || "unknown type"}).` } }
  const finalUrl = new URL(r.url || url.href)
  const html = (await r.text()).slice(0, 1_500_000)
  const ld = jsonLd(html)
  const title = text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) || finalUrl.hostname
  const description = text(html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)?.[1])
  const language = html.match(/<html[^>]+lang=["']([a-zA-Z-]{2,10})["']/i)?.[1]
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html.match(/<article[\s\S]*?<\/article>/i)?.[0] || html
  const content = cleanPageText(main.replace(/<(script|style|noscript|svg|nav|header|footer|form|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h\d|td|section|br)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim())
  const business = extractBusiness(html)
  const country = business?.address?.country, lon = Number(business?.geo?.lon)
  const [variants] = await Promise.all([shopifyVariants(finalUrl, html), remember(finalUrl, title, content)])
  const prods: any[] = products(ld, finalUrl.href)
  // Shopify: the variants (sizes, colours) with a cart link each; the product itself when the page has no product data.
  // Store pickup for the size asked for (or the first one in stock), when the shop has stores.
  let inStores: any = undefined
  if (variants && /pickup-availability/i.test(html)) {
    const want = String(opts.size || "").toLowerCase().trim()
    const v = (want && variants.variants.find((x: any) => String(x.name).toLowerCase().split(/\s*\/\s*|\s+/).includes(want) || String(x.name).toLowerCase() === want)) || variants.variants.find((x: any) => x.in_stock)
    const stores = v ? await storePickup(finalUrl.origin, v.id) : undefined
    if (stores) inStores = { variant: v.name, stores, note: "Store pickup as the shop's own product page shows it right now." }
  }
  if (variants) for (const v of variants.variants) delete v.id
  if (variants) {
    if (prods[0]) prods[0].variants = variants.variants
    else prods.push({ name: variants.name, brand: variants.brand, price: variants.price, currency: null, in_stock: variants.variants.some((v: any) => v.in_stock), url: finalUrl.href, variants: variants.variants })
  }
  const events = extractEvents(html, finalUrl.href).slice(0, 20)
  return {
    ok: true, status: 200, body: {
      url: finalUrl.href, readable: true, checked_at: new Date().toISOString(), freshness: "read live just now",
      title, ...(description ? { description } : {}), ...(language ? { language } : {}),
      text: content.slice(0, 6000), ...(content.length > 6000 ? { text_truncated: true } : {}),
      ...(prods.length ? { products: prods } : {}),
      ...(inStores ? { in_stores: inStores } : {}),
      ...(events.length ? { events } : {}),
      ...(business ? { business: { ...business, ...(business.opening_hours?.length ? { open_now: openNow(business.opening_hours, country, new Date(), business.special_hours, lon), ...(todayHours(business.opening_hours, country, lon) || {}) } : {}) } } : {}),
      ...(recipe(ld) ? { recipe: recipe(ld) } : {}), ...(faq(ld) ? { faq: faq(ld) } : {}), ...(article(ld) ? { article: article(ld) } : {}),
      ...(actions(html, finalUrl).length ? { actions: actions(html, finalUrl) } : {}),
      links: links(html, finalUrl),
      note: "Read live from the page just now. Quote it and link the user to the url to confirm."
    }
  }
}
