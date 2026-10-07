import { complete, Tier } from "./llm"
import { safeParseJSON } from "./parseAI"

// Pro: a short answer to a question search, written only from the top results, with a source
// number after each claim ("Basecamp has a free plan for one project [1]."). Nothing is added from
// the AI's own knowledge: if the sources don't answer it, there's no summary.
export const QUESTION = /^(does|do|is|are|can|could|how|what|when|where|which|who|why|will|should)\b|\?\s*$/i

export async function answerSummary(query: string, results: any[], answer: any, tier: Tier): Promise<{ text: string, sources: { n: number, domain: string, url: string }[] } | null> {
  const sources: { n: number, domain: string, url: string, text: string }[] = []
  for (const s of answer?.sentences || []) sources.push({ n: sources.length + 1, domain: answer.domain, url: s.url, text: s.text })
  for (const r of results.slice(0, 5)) {
    if (sources.length >= 6) break
    const text = r.snippet || String((Object.values(r.pages || {})[0] as any)?.content || "").slice(0, 300)
    if (text && !sources.some(s => s.text === text)) sources.push({ n: sources.length + 1, domain: r.domain, url: `https://${r.domain}`, text })
  }
  if (sources.length < 2) return null
  const prompt = `Answer the question in 2-3 short sentences, using ONLY the numbered sources below. Put the source number in brackets after each claim, like [1]. If the sources don't answer it, reply with {"answer": null}.
Question: ${query}
Sources:
${sources.map(s => `[${s.n}] ${s.domain}: ${s.text.replace(/\s+/g, " ").slice(0, 400)}`).join("\n")}
Reply with JSON only: {"answer": "..."}`
  const out = safeParseJSON(await complete(prompt, 9000, tier) || "")
  const text = typeof out?.answer === "string" ? out.answer.trim() : ""
  // Only an answer that actually cites the sources.
  if (!text || !/\[\d\]/.test(text)) return null
  const used = new Set([...text.matchAll(/\[(\d)\]/g)].map(m => Number(m[1])))
  return { text, sources: sources.filter(s => used.has(s.n)).map(({ n, domain, url }) => ({ n, domain, url })) }
}
