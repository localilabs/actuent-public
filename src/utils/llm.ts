import Groq from "groq-sdk"

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

// Groq's free tier gives each model its own daily token quota, so when one model is used up
// (or unavailable) we move on to the next. The GitHub crawlers use a different set of models
// (actuent-crawler/llm.ts) so bulk crawling can't use up live search's quota.
//
// Priority access: gpt-oss-120b is reserved for Pro, so Pro requests still get AI conversions
// after free traffic has used up the shared models' daily quota.
const FREE_MODELS = (process.env.GROQ_FREE_MODELS || "openai/gpt-oss-20b,llama-3.3-70b-versatile")
  .split(",").map(m => m.trim()).filter(Boolean)
const PRO_ONLY = (process.env.GROQ_PRO_MODELS || "openai/gpt-oss-120b")
  .split(",").map(m => m.trim()).filter(Boolean)
const PRO_MODELS = PRO_ONLY.concat(FREE_MODELS)

export type Tier = "free" | "pro"

// Model → time it can be tried again. Per serverless instance, which is enough to avoid
// re-hitting an exhausted model on every request.
const blockedUntil = new Map<string, number>()

function retryAfterMs(message: string): number {
  const match = message.match(/try again in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/)
  if (!match) return 5 * 60000
  const [, h, m, s] = match
  return ((Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0)) * 1000 || 5 * 60000
}

// Extra free providers (no credit card) for the live crawler's site conversions only — never for
// search queries, since the conversions only send public website text:
//   • Mistral (La Plateforme "Experiment" plan): MISTRAL_API_KEY
//   • GitHub Models (a GitHub token with models:read): GITHUB_MODELS_TOKEN
//   • Cloudflare Workers AI: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN
// Each is used when its key is set on Vercel; site conversions try them before Groq, which keeps
// Groq's quota for searches on busy days.
type Backup = { id: string, baseURL: string, apiKey: string, model: string }
const BACKUPS: Backup[] = [
  ...(process.env.MISTRAL_API_KEY ? [{ id: "mistral", baseURL: "https://api.mistral.ai/v1", apiKey: process.env.MISTRAL_API_KEY, model: process.env.MISTRAL_MODEL || "mistral-small-latest" }] : []),
  ...(process.env.GITHUB_MODELS_TOKEN ? [{ id: "github-models", baseURL: "https://models.github.ai/inference", apiKey: process.env.GITHUB_MODELS_TOKEN, model: process.env.GITHUB_MODELS_MODEL || "openai/gpt-4.1-mini" }] : []),
  ...(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_TOKEN ? [{ id: "cloudflare", baseURL: `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`, apiKey: process.env.CLOUDFLARE_AI_TOKEN, model: process.env.CLOUDFLARE_AI_MODEL || "@cf/mistralai/mistral-small-3.1-24b-instruct" }] : [])
]

async function callBackup(b: Backup, prompt: string, timeoutMs: number): Promise<string | null> {
  const res = await fetch(`${b.baseURL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${b.apiKey}` },
    body: JSON.stringify({ model: b.model, messages: [{ role: "user", content: prompt }], temperature: 0.1, max_tokens: 700 }),
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) { const e: any = new Error((await res.text()).slice(0, 200)); e.status = res.status; throw e }
  const data = await res.json()
  return data.choices?.[0]?.message?.content || null
}

// Returns the first model's answer, or null if every model failed. purpose "crawl" (the live
// crawler converting a website) tries the extra free providers first.
export async function complete(prompt: string, timeoutMs: number = 15000, tier: Tier = "free", purpose: "search" | "crawl" = "search"): Promise<string | null> {
  const groqModels = tier === "pro" ? PRO_MODELS : FREE_MODELS
  const order = purpose === "crawl" ? [...BACKUPS.map(b => b.id), ...groqModels] : groqModels
  for (const model of order) {
    if ((blockedUntil.get(model) || 0) > Date.now()) continue
    const backup = BACKUPS.find(b => b.id === model)
    if (backup) {
      try {
        const text = await callBackup(backup, prompt, timeoutMs)
        if (text) return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
      } catch (e: any) {
        blockedUntil.set(model, Date.now() + (e?.status === 429 ? 60_000 : 10 * 60_000))
        console.error(`llm: ${model} failed (${e?.status ?? "no status"}): ${String(e?.message || e).slice(0, 200)}`)
      }
      continue
    }
    try {
      const completion = await groq.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1
      }, { timeout: timeoutMs, maxRetries: 0 })
      const text = completion.choices?.[0]?.message?.content
      if (text) return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
    } catch (e: any) {
      const status = e?.status
      const message = String(e?.message || e)
      if (status === 429) blockedUntil.set(model, Date.now() + retryAfterMs(message))
      else if (status === 400 || status === 403 || status === 404) blockedUntil.set(model, Date.now() + 60 * 60000)
      console.error(`llm: ${model} failed (${status ?? "no status"}): ${message.slice(0, 200)}`)
    }
  }
  return null
}

// Whether any model this tier can use is available right now, and if not, when the first one frees
// up (seconds). Used to tell people "our AI helper is at capacity, try again in N minutes".
export function llmStatus(tier: Tier = "free"): { available: boolean, retryAfterSeconds: number } {
  const models = tier === "pro" ? PRO_MODELS : FREE_MODELS
  const now = Date.now()
  const waits = models.map(m => Math.max(0, (blockedUntil.get(m) || 0) - now))
  const soonest = Math.min(...waits)
  return { available: soonest === 0, retryAfterSeconds: Math.ceil(soonest / 1000) }
}
