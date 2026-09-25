// Rule-based LAWP: builds a useful LAWP from a page's HTML (or Jina markdown) without an LLM, so
// sites don't stay "minimal" while the free LLM quota is used up. Actions come from real page
// elements: search boxes, email/phone links, and links like /pricing, /book, /cart, /login.
// All output text is English: for non-English sites the description becomes an English line and
// the LLM can improve it later (conversion = "heuristic").
// Copied from actuent-crawler/heuristic.ts — keep in sync.

type Action = { id: string, name: string, description: string, intent: string[], input: { type: "text" | "none", required: boolean } }

const LANGUAGE_NAMES: Record<string, string> = {
  de: "German", fr: "French", es: "Spanish", it: "Italian", nl: "Dutch", pt: "Portuguese", da: "Danish", sv: "Swedish",
  no: "Norwegian", nb: "Norwegian", fi: "Finnish", pl: "Polish", cs: "Czech", ru: "Russian", uk: "Ukrainian", tr: "Turkish",
  ja: "Japanese", zh: "Chinese", ko: "Korean", ar: "Arabic", he: "Hebrew", hi: "Hindi", id: "Indonesian", vi: "Vietnamese",
  th: "Thai", el: "Greek", hu: "Hungarian", ro: "Romanian", fa: "Persian"
}

// Ordered by usefulness to agents; at most 6 are kept.
const RULES: { id: string, name: string, description: string, intent: string[], path?: RegExp, text?: RegExp, needsInput?: boolean }[] = [
  { id: "book", name: "Book", description: "Book an appointment, table or reservation", intent: ["book", "booking", "reserve", "appointment", "schedule"], path: /\/(book|booking|bookings|reserve|reservation|reservations|appointment|appointments|schedule)(\/|$|\?|-)/i, text: /^(book|book now|reserve|make a reservation|book online|book an appointment)$/i },
  { id: "shop", name: "Shop products", description: "Browse and buy products", intent: ["shop", "buy", "products", "store", "catalog"], path: /\/(shop|store|products|collections|catalog|catalogue)(\/|$)/i, text: /^(shop|shop now|shop all|store)$/i },
  { id: "view_pricing", name: "View pricing", description: "See plans and prices", intent: ["pricing", "prices", "plans", "cost", "how much"], path: /\/(pricing|plans|prices)(\/|$)/i, text: /^(pricing|plans|prices)$/i },
  { id: "contact", name: "Contact", description: "Get in touch with the site owner", intent: ["contact", "get in touch", "email", "message", "support"], path: /\/(contact|contact-us|kontakt|contacto)(\/|$)/i, text: /^(contact|contact us|get in touch)$/i },
  { id: "sign_up", name: "Sign up", description: "Create an account", intent: ["sign up", "register", "join", "create account", "get started"], path: /\/(signup|sign-up|register|join|create-account|get-started)(\/|$)/i, text: /^(sign up|register|join|get started|create account)$/i },
  { id: "sign_in", name: "Sign in", description: "Log in to an account", intent: ["sign in", "log in", "login", "account"], path: /\/(login|log-in|signin|sign-in)(\/|$)/i, text: /^(sign in|log in|login)$/i },
  { id: "view_cart", name: "View cart", description: "See the shopping cart and check out", intent: ["cart", "basket", "checkout", "order"], path: /\/(cart|basket|checkout)(\/|$)/i },
  { id: "track_order", name: "Track order", description: "Check the status of an order", intent: ["track order", "order status", "delivery", "shipping"], path: /\/(track|order-status|order-tracking|orders)(\/|$)/i, text: /^(track (my )?order|order status)$/i },
  { id: "find_store", name: "Find a store", description: "Find a physical store or location", intent: ["store locator", "find a store", "locations", "near me"], path: /\/(store-locator|stores|locations|find-a-store|storelocator)(\/|$)/i, text: /^(store locator|find a store|locations)$/i },
  { id: "get_support", name: "Get help", description: "Help centre, FAQs and support", intent: ["help", "support", "faq", "customer service"], path: /\/(help|support|faq|faqs|customer-service)(\/|$)/i, text: /^(help|support|faq|help center|help centre)$/i },
  { id: "subscribe", name: "Subscribe", description: "Subscribe to the newsletter or updates", intent: ["subscribe", "newsletter", "updates"], path: /\/(newsletter|subscribe)(\/|$)/i },
  { id: "careers", name: "View jobs", description: "See open positions", intent: ["careers", "jobs", "hiring", "work with us"], path: /\/(careers|jobs)(\/|$)/i },
  { id: "donate", name: "Donate", description: "Make a donation", intent: ["donate", "donation", "support us", "give"], path: /\/(donate|donation)(\/|$)/i }
]

function decode(text: string): string {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

function strip(html: string): string {
  return decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
}

function meta(html: string, name: string): string {
  const tag = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, "i"))?.[0]
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] || "").trim() : ""
}

type Link = { href: string, text: string }

function linksFrom(raw: string, isHtml: boolean): Link[] {
  const out: Link[] = []
  const re = isHtml ? /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi : /\[([^\]]{0,80})\]\((\S+?)\)/g
  for (const m of raw.matchAll(re)) {
    const href = isHtml ? m[1] : m[2]
    const text = isHtml ? strip(m[2]) : m[1].replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim()
    out.push({ href: decode(href), text })
    if (out.length > 600) break
  }
  return out
}

function pathOf(href: string, domain: string): string | null {
  try {
    const u = new URL(href, `https://${domain}`)
    const host = u.hostname.replace(/^www\./, ""), site = domain.replace(/^www\./, "")
    if (host !== site && !host.endsWith(`.${site}`)) return null
    return u.pathname.toLowerCase()
  } catch { return null }
}

export function heuristicLAWP(domain: string, raw: string, isHtml: boolean): any | null {
  if (!raw || raw.length < 200) return null

  let title: string, description: string, language: string | undefined, siteName: string
  if (isHtml) {
    title = strip(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
    description = meta(raw, "description") || meta(raw, "og:description")
    if (!description) description = (raw.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || []).map(strip).find(t => t.length > 60) || ""
    language = raw.match(/<html[^>]+lang=["']([a-z]{2})/i)?.[1]?.toLowerCase()
    siteName = meta(raw, "og:site_name")
  } else {
    title = raw.match(/^Title:\s*(.+)$/m)?.[1]?.trim() || ""
    const body = raw.split(/Markdown Content:/)[1] || raw
    description = body.split(/\n\s*\n/).map(p => p.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#*_>`|]+/g, " ").replace(/\s+/g, " ").trim())
      .find(p => p.length > 60 && !/cookie|javascript|browser/i.test(p)) || ""
    siteName = ""
  }
  if (!title && !description) return null

  const foreign = !!language && language !== "en"
  // Non-English titles would leak the original language, so foreign sites are named by brand.
  const brand = domain.replace(/^www\./, "").split(".")[0]
  const brandName = brand.charAt(0).toUpperCase() + brand.slice(1)
  const name = (siteName || (foreign ? brandName : title.split(/\s[|\-–—:]\s/)[0]) || brandName).trim().slice(0, 80)
  const content = foreign
    ? `${name} is a ${LANGUAGE_NAMES[language!] || language}-language website at ${domain}.`
    : (description || title).slice(0, 400)

  const links = linksFrom(raw, isHtml)
  const actions: Action[] = []
  const add = (a: Action) => { if (!actions.some(x => x.id === a.id) && actions.length < 6) actions.push(a) }

  // A search box on the page (HTML only) is the most useful action for agents.
  if (isHtml && (/<input[^>]+type=["']search["']/i.test(raw) || /<input[^>]+name=["'](q|s|query|search|keyword|keywords)["']/i.test(raw) || /role=["']search["']/i.test(raw))) {
    add({ id: "search", name: "Search the site", description: `Search ${name}`, intent: ["search", "find", "look up"], input: { type: "text", required: true } })
  }
  for (const rule of RULES) {
    const hit = links.some(l => {
      const p = pathOf(l.href, domain)
      return (p !== null && rule.path?.test(p)) || (!!l.text && !!rule.text?.test(l.text.trim()))
    })
    if (hit) add({ id: rule.id, name: rule.name, description: rule.description, intent: rule.intent, input: { type: "text", required: false } })
  }
  const email = raw.match(/mailto:([^"'?\s>)]+@[^"'?\s>)]+)/i)?.[1]
  if (email && !actions.some(a => a.id === "contact")) add({ id: "contact", name: "Contact", description: `Email ${decode(email)}`, intent: ["contact", "email", "get in touch", "message"], input: { type: "text", required: false } })
  const phone = raw.match(/tel:([+\d][\d\s().-]{5,})/i)?.[1]
  if (phone) add({ id: "call", name: "Call", description: `Call ${phone.trim()}`, intent: ["call", "phone", "telephone"], input: { type: "none", required: false } })

  if (!actions.length) return null
  return {
    domain,
    name,
    language: language || "en",
    pages: { "/": { title: foreign ? name : (title || name).slice(0, 120), content } },
    actions
  }
}

// Infrastructure hostnames (DNS, CDN, ad and certificate servers) in the Tranco list have no
// website for people; skip them instead of indexing empty entries.
export const INFRASTRUCTURE = /(^|\.)(awsdns-\d+|akamai\w*|akadns\w*|edgekey|edgesuite|cloudfront|fastly\w*|gstatic|googleapis|googleusercontent|doubleclick|googlesyndication|googletagmanager|googleadservices|googlevideo|ggpht|ytimg|fbcdn|amazonaws|azureedge|azurefd|trafficmanager|msedge|windowsupdate|digicert|root-servers|gtld-servers|nstld|ocsp|\w*cdn\d*|dns\d*|ntp\d*|app-measurement|crashlytics|scorecardresearch|adnxs|nr-data|dnsowl)\./i
