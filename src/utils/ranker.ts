import { TypeSafeClient, score } from "@typesafe-ai/sdk"
import { Site } from "../data/sites"

const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY })

export async function rerankWithJev(query: string, sites: Site[]): Promise<Site[]> {
  if (sites.length <= 1 || !process.env.TYPESAFE_API_KEY) return sites

  try {
    const state = `
Search query: "${query}"

Sites to rank:
${sites.map((s, i) => `
Site ${i}: ${s.domain} — ${s.name}
Content: ${Object.values(s.pages)[0]?.content?.slice(0, 200) || ""}
Actions: ${s.actions?.map(a => a.intent.slice(0, 3).join(", ")).join(" | ") || "none"}
`).join("\n")}
`

    const questions: Record<string, any> = {}
    sites.forEach((_, i) => {
      questions[`site_${i}`] = score(
        `How relevant is Site ${i} to the query "${query}"?`,
        {
          perfect: "Exactly matches the query intent",
          high: "Strongly relevant to the query",
          medium: "Somewhat relevant",
          low: "Tangentially related",
          none: "Not relevant"
        }
      )
    })

    const { answers } = await client.systemOne({ state, questions })

    const scoreMap: Record<string, number> = {
      perfect: 5,
      high: 4,
      medium: 3,
      low: 2,
      none: 1
    }

    const ranked = sites
      .map((site, i) => ({
        site,
        jevScore: scoreMap[answers[`site_${i}`]?.choice || "none"] || 0
      }))
      .sort((a, b) => b.jevScore - a.jevScore)
      .map(r => r.site)

    return ranked
  } catch {
    return sites
  }
}
