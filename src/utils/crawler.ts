import Groq from "groq-sdk"
import { Site } from "../data/sites"
import { safeParseJSON } from "./parseAI"
import { diffLAWP, saveDiff } from "./diff"

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

async function getSavedSite(domain: string): Promise<Site | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lawp_sites?domain=eq.${domain}&select=*`,
      { headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` } }
    )
    const data = await res.json()
    if (!data || data.length === 0) return null
    return { domain: data[0].domain, name: data[0].name, pages: data[0].pages, actions: data[0].actions }
  } catch { return null }
}

async function saveSite(site: Site, language: string = "en"): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
      },
      body: JSON.stringify({ domain: site.domain, name: site.name, pages: site.pages, actions: site.actions, language, updated_at: new Date().toISOString() })
    })
  } catch {}
}

async function savePage(domain: string, path: string, title: string, content: string, actions: any[]): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/lawp_pages`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
      },
      body: JSON.stringify({ domain, path, full_url: `${domain}${path}`, title, content, actions, updated_at: new Date().toISOString() })
    })
  } catch {}
}

async function getPageFromDB(fullUrl: string): Promise<any | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lawp_pages?full_url=eq.${encodeURIComponent(fullUrl)}&select=*`,
      { headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` } }
    )
    const data = await res.json()
    if (!data || data.length === 0) return null
    return data[0]
  } catch { return null }
}

async function scrapeWithJina(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { "Accept": "text/plain", "X-No-Cache": "true" },
      signal: AbortSignal.timeout(10000)
    })
    if (!res.ok) return null
    const text = await res.text()
    if (!text || text.length < 50) return null
    return text.slice(0, 3000)
  } catch { return null }
}

async function scrapeBasic(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Actuent/1.0; +https://actuent.ai)" },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return null
    const html = await res.text()
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000)
  } catch { return null }
}

async function fetchContent(url: string): Promise<string | null> {
  const jina = await scrapeWithJina(url)
  if (jina) return jina
  return await scrapeBasic(url)
}

function minimalLAWP(domain: string, content: string): Site {
  return {
    domain,
    name: domain.split(".")[0].charAt(0).toUpperCase() + domain.split(".")[0].slice(1),
    pages: { "/": { title: domain, content: content.slice(0, 200) || `Website at ${domain}` } },
    actions: []
  }
}

async function convertToLAWP(domain: string, content: string): Promise<Site> {
  try {
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [{
        role: "user",
        content: `Convert this website into LAWP format.\n\nDomain: ${domain}\nContent: ${content}\n\nReturn ONLY valid JSON:\n{"domain":"${domain}","name":"Site name","pages":{"/":{"title":"Title","content":"Summary under 150 words"}},"actions":[{"id":"id","name":"Name","description":"What","intent":["k1","k2","k3"],"input":{"type":"text","required":false}}]}\n\nInclude 2-4 real actions only.`
      }],
      temperature: 0.1
    })
    const raw = completion.choices?.[0]?.message?.content
    if (!raw) return minimalLAWP(domain, content)
    const parsed = safeParseJSON(raw)
    if (!parsed || !parsed.domain) return minimalLAWP(domain, content)
    return parsed as Site
  } catch {
    return minimalLAWP(domain, content)
  }
}

async function detectAndTranslate(content: string): Promise<{ content: string, lang: string }> {
  try {
    const sample = content.slice(0, 200)
    const ascii = sample.replace(/[^\x00-\x7F]/g, "").length
    const ratio = ascii / sample.length
    if (ratio > 0.85) return { content, lang: "en" }

    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [{
        role: "user",
        content: `Detect language and translate to English if not English.\n\nRespond ONLY as JSON: {"lang":"en","translated":"[text]"}\n\nText: ${content.slice(0, 1000)}`
      }],
      temperature: 0
    })
    const raw = completion.choices?.[0]?.message?.content
    const parsed = safeParseJSON(raw || "")
    if (parsed?.lang && parsed?.translated) {
      return { content: parsed.translated, lang: parsed.lang }
    }
    return { content, lang: "en" }
  } catch {
    return { content, lang: "en" }
  }
}

export async function crawlPage(domain: string, path: string): Promise<any | null> {
  const fullUrl = `${domain}${path}`
  const cached = await getPageFromDB(fullUrl)
  if (cached) return cached

  const content = await fetchContent(`https://${domain}${path}`)
  if (!content) return null

  const { content: translated } = await detectAndTranslate(content)

  let title = path.replace("/", "") || domain
  let summary = translated.slice(0, 200)
  let actions: any[] = []

  try {
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [{
        role: "user",
        content: `Convert this page to LAWP format.\nDomain: ${domain}, Path: ${path}\nContent: ${translated}\n\nReturn ONLY JSON: {"title":"Title","content":"Summary under 150 words","actions":[{"id":"id","name":"Name","description":"What","intent":["k1","k2"],"input":{"type":"text","required":false}}]}`
      }],
      temperature: 0.1
    })
    const raw = completion.choices?.[0]?.message?.content
    const parsed = safeParseJSON(raw || "")
    if (parsed) {
      title = parsed.title || title
      summary = parsed.content || summary
      actions = parsed.actions || []
    }
  } catch {}

  await savePage(domain, path, title, summary, actions)
  return { domain, path, full_url: fullUrl, title, content: summary, actions }
}

export async function crawlSite(domain: string): Promise<Site | null> {
  const saved = await getSavedSite(domain)
  if (saved) return saved

  const content = await fetchContent(`https://${domain}`)
  if (!content) return null

  const { content: translated, lang } = await detectAndTranslate(content)
  const site = await convertToLAWP(domain, translated)

  const existing = await getSavedSite(domain)
  if (existing) {
    const changes = diffLAWP(existing, site)
    if (Object.keys(changes).length > 0) {
      await saveDiff(domain, existing, site, changes)
    }
  }

  await saveSite(site, lang)
  await savePage(domain, "/", Object.values(site.pages)[0]?.title || domain, Object.values(site.pages)[0]?.content || "", site.actions)

  return site
}