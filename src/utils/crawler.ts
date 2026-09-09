import Groq from "groq-sdk"
import { Site } from "../data/sites"
import { safeParseJSON } from "./parseAI"

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

function stripHTML(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000)
}

function extractLinks(html: string, domain: string): string[] {
  const matches = html.matchAll(/href=["']([^"']+)["']/gi)
  const links = new Set<string>()

  for (const match of matches) {
    const href = match[1]
    if (href.startsWith("/") && !href.startsWith("//")) {
      links.add(href)
    }
  }

  const priorityPaths = ["/about", "/services", "/contact", "/pricing", "/menu", "/booking"]
  return [...links].filter(l => priorityPaths.some(p => l.startsWith(p))).slice(0, 4)
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

export async function crawlSite(domain: string): Promise<Site | null> {
  const baseUrl = `https://${domain}`

  const homeHTML = await fetchPage(baseUrl)
  if (!homeHTML) return null

  const homeText = stripHTML(homeHTML)
  const extraLinks = extractLinks(homeHTML, domain)

  const pages: Record<string, { title: string; content: string }> = {
    "/": { title: domain, content: homeText }
  }

  for (const path of extraLinks) {
    const html = await fetchPage(`${baseUrl}${path}`)
    if (html) {
      pages[path] = { title: path.replace("/", ""), content: stripHTML(html) }
    }
  }

  const prompt = `
You are converting a website into LAWP (Locali AI Web Protocol) format.

Domain: ${domain}
Pages content:
${Object.entries(pages).map(([path, page]) => `${path}: ${page.content}`).join("\n\n")}

Return ONLY valid JSON in this exact format:
{
  "domain": "${domain}",
  "name": "Site name here",
  "pages": {
    "/": { "title": "Page title", "content": "Clean summary of page content" }
  },
  "actions": [
    {
      "id": "action_id",
      "name": "Action name",
      "description": "What this action does",
      "intent": ["keyword1", "keyword2"],
      "input": { "type": "text", "required": false }
    }
  ]
}

Only include real actions the site actually supports (booking, search, contact etc).
Keep content summaries under 200 words per page.
`

  const completion = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1
  })

  const raw = completion.choices?.[0]?.message?.content
  if (!raw) return null

  const parsed = safeParseJSON(raw)
  if (!parsed || !parsed.domain) return null

  return parsed as Site
}