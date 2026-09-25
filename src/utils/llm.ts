import Groq from "groq-sdk"

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

// Groq's free tier gives each model its own daily token quota, so when one model is used up
// (or unavailable) we move on to the next. The GitHub crawlers use a different set of models
// (actuent-crawler/llm.ts) so bulk crawling can't use up live search's quota.
// Override with GROQ_MODELS="a,b,c".
const MODELS = (process.env.GROQ_MODELS || [
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile"
].join(",")).split(",").map(m => m.trim()).filter(Boolean)

// Model → time it can be tried again. Per serverless instance, which is enough to avoid
// re-hitting an exhausted model on every request.
const blockedUntil = new Map<string, number>()

function retryAfterMs(message: string): number {
  const match = message.match(/try again in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/)
  if (!match) return 5 * 60000
  const [, h, m, s] = match
  return ((Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0)) * 1000 || 5 * 60000
}

// Returns the first model's answer, or null if every model failed.
export async function complete(prompt: string, timeoutMs: number = 15000): Promise<string | null> {
  for (const model of MODELS) {
    if ((blockedUntil.get(model) || 0) > Date.now()) continue
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
