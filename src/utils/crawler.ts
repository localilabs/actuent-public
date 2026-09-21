import Groq from "groq-sdk"
import { Site } from "../data/sites"
import { safeParseJSON } from "./parseAI"
import { diffLAWP, saveDiff } from "./diff"

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY!

async function detectLanguage(text: string): Promise<string> {
  try {
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [{
        role: "user",
        content: `What language is this text? Reply with ONLY the ISO 639-1 code (en, da, de, fr, es, nl, sv, no, it, pt, ja, zh, ko, ar). Text: ${text.slice(0, 200)}`
      }],
      temperature: 0
    })
    return completion.choices?.[0]?.message?.content?.trim().toLowerCase().slice(0, 2) || "en"
  } catch {
    return "en"
  }
}

async function translateToEnglish(text: string, fromLang: string): Promise<string> {
  if (fromLang === "en") return text
  try {
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [{
        role: "user",
        content: `Translate this ${fromLang} text to plain English. Return ONLY the translation:\n\n${text}`
      }],
      temperature: 0.1
    })
    return completion.choices?.[0]?.message?.content?.trim() || text
  } catch {
    return text
  }
}

async function getSavedSite(domain: string): Promise<Site | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lawp_sites?domain=eq.${domain}&select=*`,
      {
        headers: {
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`
        }
      }
    )
    const data = await res.json()
    if (!data || data.length === 0) return null
    return {
      domain: data[0].domain,
      name: data[0].name,
      pages: data[0].pages,
      actions: data[0].actions
    }
  } catch {
    return null
  }
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
      body: JSON.stringify({
        domain: site.domain,
        name: site.name,
        pages: site.pages,
        actions: site.actions,
        language,
        updated_at: new Date().toISOString()
      })
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
      body: JSON.stringify({
        domain,
        path,
        full_url: `${domain}${path}`,
        title,
        content,
        actions,
        updated_at: new Date().toISOString()
      })
    })
  } catch {}
}

async function getPageFromDB(fullUrl: string): Promise<any | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lawp_pages?full_url=eq.${encodeURIComponent(fullUrl)}&select=*`,
      {
        headers: {
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`
        }
      }
    )
    const data = await res.json()
    if (!data || data.length === 0) return null
    return data[0]
  } catch {
    return null
  }
}

async function scrapeWithFirecrawl(url: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true })
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.data?.markdown || null
  } catch {
    return null
  }
}

async function convertToLAWP(domain: string, content: string): Promise<Site | null> {
  const prompt = `
Convert this website content into LAWP (Locali AI Web Protocol) format.

Domain: ${domain}
Content:
${content.slice(0, 3000)}

Return ONLY valid JSON:
{
  "domain": "${domain}",
  "name": "Site name",
  "pages": {
    "/": { "title": "Page title", "content": "Plain English summary under 150 words" }
  },
  "actions": [
    {
      "id": "action_id",
      "name": "Action name",
      "description": "What it does",
      "intent": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
      "input": { "type": "text", "required": false }
    }
  ]
}

Include 3-6 real actions. Be specific with intents.
`

  try {
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1
    })
    const raw = completion.choices?.[0]?.message?.content
    if (!raw) return null
    const parsed = safeParseJSON(raw)
    if (!parsed || !parsed.domain) return null
    return parsed as Site
  } catch {
    return null
  }
}

async function convertPageToLAWP(domain: string, path: string, content: string): Promise<{ title: string, content: string, actions: any[] } | null> {
  const prompt = `
Convert this webpage into LAWP format.

Domain: ${domain}
Path: ${path}
Content: ${content.slice(0, 3000)}

Return ONLY valid JSON:
{
  "title": "Page title",
  "content": "Plain English summary under 150 words",
  "actions": [
    {
      "id": "action_id",
      "name": "Action name",
      "description": "What it does",
      "intent": ["keyword1", "keyword2", "keyword3"],
      "input": { "type": "text", "required": false }
    }
  ]
}
`

  try {
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1
    })
    const raw = completion.choices?.[0]?.message?.content
    if (!raw) return null
    return safeParseJSON(raw)
  } catch {
    return null
  }
}

export async function crawlPage(domain: string, path: string): Promise<any | null> {
  const fullUrl = `${domain}${path}`
  const cached = await getPageFromDB(fullUrl)
  if (cached) return cached

  const markdown = await scrapeWithFirecrawl(`https://${domain}${path}`)
  if (!markdown) return null

  const lang = await detectLanguage(markdown.slice(0, 300))
  const content = lang !== "en" ? await translateToEnglish(markdown, lang) : markdown

  const lawp = await convertPageToLAWP(domain, path, content)
  if (!lawp) return null

  await savePage(domain, path, lawp.title, lawp.content, lawp.actions)

  return { domain, path, full_url: fullUrl, ...lawp }
}

export async function crawlSite(domain: string): Promise<Site | null> {
  const saved = await getSavedSite(domain)
  if (saved) return saved

  const markdown = await scrapeWithFirecrawl(`https://${domain}`)
  if (!markdown) return null

  const lang = await detectLanguage(markdown.slice(0, 300))
  const content = lang !== "en" ? await translateToEnglish(markdown, lang) : markdown

  const site = await convertToLAWP(domain, content)
  if (!site) return null

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
