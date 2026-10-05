import { wikipediaSummary } from "./define"
import { brandSites } from "./brand"
import { robotsAllows } from "./robots"

// Two kinds of search that aren't lists of sites:
//   • comparisons: "notion vs obsidian", "stripe or paypal" → both sites, side by side.
//   • questions about one site: "does basecamp have a free plan" → the site first, plus the
//     sentences from its own pages that answer it, with the page each came from.

const SUPABASE_URL = process.env.SUPABASE_URL!
const HEADERS = { "apikey": process.env.SUPABASE_SERVICE_KEY!, "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}` }

export function comparisonSides(q: string): [string, string] | null {
  const m = q.trim().match(/^(.{2,40}?)\s+(?:vs\.?|versus|or|compared to|compared with|against)\s+(.{2,40})$/i)
  if (!m) return null
  const a = m[1].trim(), b = m[2].trim()
  return a.split(/\s+/).length <= 3 && b.split(/\s+/).length <= 3 ? [a, b] : null
}

export async function comparison(q: string): Promise<any[] | null> {
  const sides = comparisonSides(q)
  if (!sides) return null
  const [a, b] = await Promise.all(sides.map(s => brandSites(s.toLowerCase().replace(/\.[a-z]{2,}$/, ""))))
  return a[0] && b[0] ? [a[0], b[0]] : null
}

const QUESTION = /^(does|do|is|are|can|could|how much|how many|how do i|how to|what|when|where|which|who|why|will)\b/i
const STOP = new Set("does do is are can could how much many what when where which who why will i you they it the a an of for to in on at with have has had there their your my any some cost costs price prices plan plans free open founded founder founders owns owner owned based from headquartered headquarters made history started ceo origin company brand pricing return returns refund refunds shipping delivery student students discount discounts trial subscription subscriptions warranty cancel cancellation customer service support contact policy tier version".split(" "))

// The site the question is about: the first word or two that match a site's name or domain.
// The same questions as keywords, the way assistants rewrite them: "patagonia free returns", "notion
// free plan pricing", "spotify student discount". Not plain prices ("hoka clifton 9 price" is a product).
const TOPIC = /\b(free (plan|tier|trial|version|shipping|returns?)|pricing|plans|subscriptions?|student|discounts?|trial|returns?|return policy|refunds?|shipping|delivery|warranty|cancel(lation)?|customer service|support|contact|founded|founders?|owners?|headquarters)\b/i
export async function questionSite(q: string): Promise<{ site: any, keywords: string[] } | null> {
  const n = q.trim().split(/\s+/).length
  if (!(QUESTION.test(q.trim()) && n <= 14) && !(TOPIC.test(q) && n >= 2 && n <= 7)) return null
  const words = q.toLowerCase().replace(/[?!.,]/g, " ").split(/\s+/).filter(Boolean)
  const candidates = words.filter(w => w.length >= 3 && !STOP.has(w)).slice(0, 4)
  const tries = [...candidates.slice(0, -1).map((w, i) => `${w} ${candidates[i + 1]}`), ...candidates]
  const found = await Promise.all(tries.map(t => brandSites(t).then(r => r[0] || null).catch(() => null)))
  const i = found.findIndex(Boolean)
  if (i < 0) return null
  const nameWords = new Set(tries[i].split(" "))
  return { site: found[i], keywords: words.filter(w => w.length >= 3 && !nameWords.has(w) && !["does", "have", "what", "when", "where", "which", "there"].includes(w)) }
}

// The words of a question worth looking for on a site's pages ("is there a free plan?" → ["free",
// "plan"]). Only question words go: unlike STOP (for spotting the site's name), "free", "plan" and
// "price" are exactly what to look for.
const QUESTION_WORDS = new Set("does do is are can could how much many what when where which who why will would should i you they it its the a an of for to in on at with have has had there their your my any some me we us our get from about this that them was were been tell know".split(" "))
export function questionKeywords(q: string, siteName = ""): string[] {
  const nameWords = new Set(siteName.toLowerCase().split(/[\s.]+/))
  return q.toLowerCase().replace(/[?!.,]/g, " ").split(/\s+/).filter(w => w.length >= 3 && !QUESTION_WORDS.has(w) && !nameWords.has(w)).slice(0, 8)
}

// Questions about the company itself ("where is New Balance from", "who owns Zara", "when was IKEA
// founded"): a shop's pages rarely say, so Wikipedia's summary and the site's own about page answer.
export const COMPANY_QUESTION = /\b(where\b.*\b(from|based|headquartered|made|located)|founded|founder|founders|headquarter(s|ed)?|who owns|owned by|owner|parent company|history|origin|started|ceo|based in|made in|how old|nationality)\b/i
// Actuent's own page summaries describe the page ("The homepage showcases quick links…"): not facts.
const ABOUT_THE_PAGE = /\b(the (page|homepage|site|website|landing page)|this (page|site)|homepage|visitors?|layout|navigation|showcases?|sleek|quick links|visual overview|encourag(es|ing)|users can|you can explore)\b/i

async function aboutPage(domain: string): Promise<{ url: string, text: string } | null> {
  const host = domain.replace(/^www\./, "")
  const pages = await Promise.all(["/about", "/about-us", "/our-story", "/company", "/en/about"].map(async path => {
    try {
      if (!await robotsAllows(host, path)) return null
      const r = await fetch(`https://${host}${path}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Actuent/1.0; +https://docs.actuent.ai/bot)", "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(2500) })
      if (!r.ok || !(r.headers.get("content-type") || "").includes("html") || /\/(404|not-found)/.test(r.url) || new URL(r.url).pathname === "/") return null
      const html = (await r.text()).slice(0, 800_000)
      const text = html.replace(/<(script|style|noscript|svg|nav|header|footer)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<\/(p|div|li|h\d|td|section)>/gi, ". ").replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(Number(c))).replace(/\s*\.\s*(\.\s*)+/g, ". ").replace(/\s+/g, " ")
      return text.length > 300 ? { url: r.url, text } : null
    } catch { return null }
  }))
  return pages.filter(Boolean).sort((a, b) => b!.text.length - a!.text.length)[0] || null
}

export async function answerFromSite(site: any, keywords: string[], question = ""): Promise<{ domain: string, sentences: { text: string, url: string }[] } | null> {
  if (COMPANY_QUESTION.test(question)) {
    const name = String(site.name || site.domain.split(".")[0]).replace(/\s*[|–-].*$/, "").trim()
    // The company's article: "Zara (retailer)", "Patagonia (clothing)" when the plain name is something else.
    const isCompany = (w: any) => w && /compan|brand|manufactur|retailer|corporation|business|founded|headquarter|footwear|clothing|maker|chain|firm/i.test(`${w.description || ""} ${w.extract}`)
    const findWiki = async () => {
      // The site's name can be a slogan ("Patagonia Outdoor Clothing & Gear"): also the domain's brand word.
      const brand = String(site.domain).split("/")[0].replace(/^www\./, "").split(".")[0].replace(/-/g, " ")
      const names = [...new Set([name, brand.charAt(0).toUpperCase() + brand.slice(1), name.split(/\s+/).slice(0, 2).join(" ")])].filter(Boolean)
      for (const t of names.flatMap(n => [n, `${n} (company)`, `${n} (retailer)`, `${n} (clothing)`, `${n} (brand)`, `${n}, Inc.`])) {
        const w = await wikipediaSummary(t).catch(() => null)
        if (isCompany(w)) return w
      }
      return null
    }
    const [wiki, about] = await Promise.all([findWiki(), aboutPage(String(site.domain).split("/")[0]).catch(() => null)])
    const out: { text: string, url: string }[] = []
    if (wiki) {
      // The opening sentence, plus the ones that say where, when and who.
      // "Inc.", "Co.", "U.S." don't end a sentence.
      const ss = wiki.extract.replace(/\b(Inc|Co|Ltd|Corp|Bros|St|Mr|Dr|U\.S|U\.K|No)\.\s/g, "$1\u0000 ").split(/(?<=[.!?])\s+/).map(x => x.replace(/\u0000/g, "."))
      const facts = ss.slice(1).filter(x => /\b(headquarter|based in|founded|established|owned|parent|subsidiary|origin|started|located)\b/i.test(x)).slice(0, 2)
      out.push({ text: [ss[0], ...facts].join(" "), url: wiki.url })
    }
    if (about) {
      const ks = [...keywords, "founded", "since", "headquarter", "based", "family", "started", "history", "born"].map(k => k.toLowerCase().replace(/(ies|es|s)$/, ""))
      const best = about.text.split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(x => x.length >= 30 && x.length <= 350 && !ABOUT_THE_PAGE.test(x))
        .map(x => ({ x, n: ks.filter(k => k.length >= 3 && x.toLowerCase().includes(k)).length + (/\b(1[89]\d\d|20\d\d)\b/.test(x) ? 1 : 0) })).filter(y => y.n >= 2).sort((a, b) => b.n - a.n).slice(0, 2)
      for (const b of best) out.push({ text: b.x, url: about.url })
    }
    if (out.length) return { domain: site.domain, sentences: out.slice(0, 3) }
  }
  // A page result's domain already has its path ("notion.so/pricing"): links use the host only, or they'd
  // point at notion.so/pricing/pricing. Full URLs stay as they are.
  const host = String(site.domain).split("/")[0]
  const link = (path: string) => /^https?:\/\//.test(path) ? path : `https://${host}${path.startsWith("/") ? path : `/${path}`}`
  const pages: { url: string, text: string }[] = Object.entries(site.pages || {}).map(([path, p]: any) => ({ url: link(path), text: `${p?.title || ""}. ${p?.content || ""}` }))
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_pages?select=path,title,content&domain=eq.${encodeURIComponent(host)}&limit=40`, { headers: HEADERS, signal: AbortSignal.timeout(2000) })
    for (const p of r.ok ? await r.json() : []) pages.push({ url: link(String(p.path || "/")), text: `${p.title || ""}. ${p.content || ""}` })
  } catch {}
  // Price and plan questions ("does notion have a free plan") when the site's pricing page isn't in
  // the index: read it live (a few seconds at most), so the answer comes from the right page.
  // An indexed pricing page counts only if it mentions what's asked ("student"): otherwise read it live.
  const ks = keywords.map(k => k.toLowerCase().replace(/(ies|es|s)$/, "")).filter(k => k.length >= 3)
  if (PRICING.test(keywords.join(" ")) && !pages.some(p => PRICING_PAGE.test(p.url) && ks.some(k => p.text.toLowerCase().includes(k)))) {
    const live = await pricingPage(host, keywords).catch(() => null)
    if (live) pages.push(live)
  }
  const stems = keywords.map(k => k.replace(/(ies|es|s)$/, ""))
  const scored: { text: string, url: string, score: number }[] = []
  for (const page of pages) {
    for (const sentence of page.text.split(/(?<=[.!?])\s+/)) {
      const s = sentence.trim(), lower = s.toLowerCase()
      if (s.length < 25 || s.length > 400 || ABOUT_THE_PAGE.test(s)) continue
      // Menus glued into a "sentence" ("Home Premium Plans Support Download"): mostly Capitalised words.
      const w = s.split(/\s+/), caps = w.filter(x => /^[A-ZÆØÅ]/.test(x)).length
      if (w.length >= 5 && caps / w.length > 0.6) continue
      // Pricing pages count a little more for price questions; a sentence about something else that
      // shares one word ("unlimited forms for free") counts less than one about the plan itself.
      const score = stems.filter(k => k.length >= 3 && lower.includes(k)).length + (score0(page.url, keywords))
      if (score >= 1) scored.push({ text: s, url: page.url, score })
    }
  }
  const seen = new Set<string>()
  const best = scored.sort((a, b) => b.score - a.score).filter(x => !seen.has(x.text) && seen.add(x.text)).slice(0, 3)
  return best.length ? { domain: site.domain, sentences: best.map(({ text, url }) => ({ text, url })) } : null
}

const PRICING = /\b(free|plans?|price|prices|pricing|cost|costs|subscriptions?|trial|cheap|paid|discounts?|student|students|family|premium|membership|how much)\b/i
const PRICING_PAGE = /\/(pricing|prices|plans|premium|priser|preise|tarifs)\b/i
const score0 = (url: string, keywords: string[]) => PRICING.test(keywords.join(" ")) && PRICING_PAGE.test(url) ? 0.5 : 0


// Sites call it different things (Spotify: /premium): the first of these that answers, read in parallel.
export async function pricingPage(domain: string, keywords: string[] = []): Promise<{ url: string, text: string } | null> {
  const host = domain.replace(/^www\./, "")
  const pages = await Promise.all(["/pricing", "/premium", "/plans"].map(async path => {
    try {
      if (!await robotsAllows(host, path)) return null
      const r = await fetch(`https://${host}${path}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Actuent/1.0; +https://docs.actuent.ai/bot)", "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(2500) })
      if (!r.ok || !(r.headers.get("content-type") || "").includes("html") || /\/(404|not-found)/.test(r.url)) return null
      const html = (await r.text()).slice(0, 800_000)
      const text = html.replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<\/(p|div|li|h\d|td|section|a|button|span|label|option|nav|header|footer)>/gi, ". ").replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(Number(c))).replace(/\s*\.\s*(\.\s*)+/g, ". ").replace(/\s+/g, " ")
      return { url: r.url, text }
    } catch { return null }
  }))
  // Sites have stubs at some of these (Spotify's /pricing is nearly empty; /premium has the plans):
  // the page that mentions the question's words most, then the fuller one.
  const stems = keywords.map(k => k.toLowerCase().replace(/(ies|es|s)$/, "")).filter(k => k.length >= 3)
  const hits = (t: string) => { const l = t.toLowerCase(); return stems.reduce((n, k) => n + l.split(k).length - 1, 0) }
  const found = pages.filter((p): p is { url: string, text: string } => !!p && p.text.length > 200)
  return found.sort((a, b) => hits(b.text) - hits(a.text) || b.text.length - a.text.length)[0] || null
}
