import Groq from "groq-sdk"
import { Site } from "../data/sites"
import { safeParseJSON } from "./parseAI"

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

function stripHTML(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3000)
}

function extractLinks(html: string, domain: string): string[] {
  const matches = html.matchAll(/href=["']([^"'#?]+)["']/gi)
  const links = new Set<string>()

  for (const match of matches) {
    const href = match[1]
    if (href.startsWith("/") && !href.startsWith("//")) {
      links.add(href)
    } else if (href.startsWith(`https://${domain}`)) {
      const path = href.replace(`https://${domain}`, "")
      if (path) links.add(path)
    }
  }

  return [...links]
    .filter(l => !l.match(/\.(css|js|png|jpg|gif|svg|ico|woff|pdf)$/i))
    .slice(0, 20)
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Actuent-Crawler/1.0 (https://actuent.ai)" },
      signal: AbortSignal.timeout(5000)
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
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
    return { domain: data[0].domain, name: data[0].name, pages: data[0].pages, actions: data[0].actions }
  } catch {
    return null
  }
}

async function saveSite(site: Site): Promise<void> {
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
        updated_at: new Date().toISOString()
      })
    })
  } catch {}
}

async function convertPageToLAWP(domain: string, path: string, content: string): Promise<{ title: string, content: string, actions: any[] } | null> {
  const prompt = `
Convert this webpage into LAWP (Locali AI Web Protocol) format.

Domain: ${domain}
Path: ${path}
Content: ${content}

Return ONLY valid JSON:
{
  "title": "Page title",
  "content": "Plain English summary of what this page contains, under 150 words",
  "actions": [
    {
      "id": "action_id",
      "name": "Action name",
      "description": "What this action does",
      "intent": ["keyword1", "keyword2", "keyword3"],
      "input": { "type": "text", "required": false }
    }
  ]
}

Only include real actions available on this specific page.
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

  const html = await fetchPage(`https://${domain}${path}`)
  if (!html) return null

  const rawContent = stripHTML(html)
  const lawp = await convertPageToLAWP(domain, path, rawContent)
  if (!lawp) return null

  await savePage(domain, path, lawp.title, lawp.content, lawp.actions)

  return { domain, path, full_url: fullUrl, ...lawp }
}

export async function crawlSite(domain: string): Promise<Site | null> {
  const saved = await getSavedSite(domain)
  if (saved) return saved

  const homeHTML = await fetchPage(`https://${domain}`)
  if (!homeHTML) return null

  const homeText = stripHTML(homeHTML)
  const allLinks = extractLinks(homeHTML, domain)

  const pages: Record<string, { title: string; content: string }> = {
    "/": { title: domain, content: homeText }
  }

  await savePage(domain, "/", domain, homeText, [])

  const priorityPaths = allLinks
    .filter(l => ["/about", "/services", "/contact", "/pricing", "/products", "/shop", "/menu", "/booking"].some(p => l.startsWith(p)))
    .slice(0, 6)

  for (const path of priorityPaths) {
    const html = await fetchPage(`https://${domain}${path}`)
    if (html) {
      const content = stripHTML(html)
      pages[path] = { title: path.replace("/", ""), content }
      await savePage(domain, path, path.replace("/", ""), content, [])
    }
  }

  const prompt = `
Convert this website into LAWP (Locali AI Web Protocol) format.

Domain: ${domain}
Pages:
${Object.entries(pages).map(([p, page]) => `${p}: ${page.content}`).join("\n\n")}

Return ONLY valid JSON:
{
  "domain": "${domain}",
  "name": "Site name",
  "pages": {
    "/": { "title": "Title", "content": "Plain English summary under 150 words" }
  },
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

Only include real actions the site supports.
`

  const completion = await groq.chat.completions.create({
    model: "openai/gpt-oss-20b",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1
  })

  const raw = completion.choices?.[0]?.message?.content
  if (!raw) return null

  const parsed = safeParseJSON(raw)
  if (!parsed || !parsed.domain) return null

  const site = parsed as Site
  await saveSite(site)

  return site
}
