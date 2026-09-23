import { Router } from "express"
import Groq from "groq-sdk"
import { rerankWithJev } from "./ranker"

const router = Router()

// Initialize native Groq SDK Client
const client = new Groq({
  apiKey: process.env.GROQ_API_KEY
})

router.post("/", async (req, res) => {
  try {
    const { query } = req.body

    if (!query) {
      return res.status(400).json({ error: "Missing query" })
    }

    const completion = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `
You are an AI search engine that thinks in structured plans.

Return ONLY valid JSON.

Format:
{
  "title": "",
  "summary": "",
  "steps": [
    { "id": "1", "text": "" }
  ],
  "graph": {
    "nodes": [
      { "id": "1", "label": "" }
    ],
    "edges": [
      { "from": "1", "to": "2" }
    ]
  }
}

Rules:
- Each step must have a matching node
- Nodes represent steps
- Edges represent order (1 → 2 → 3 etc.)
- Keep it clean and minimal
`
        },
        {
          role: "user",
          content: query
        }
      ],
      temperature: 0.3
    })

    const content = completion.choices?.[0]?.message?.content

    if (!content) {
      return res.status(500).json({ error: "No response from AI" })
    }

    try {
      const parsed = JSON.parse(content)
      return res.json(parsed)
    } catch {
      return res.status(500).json({ error: "Invalid JSON from AI" })
    }

  } catch (err) {
    return res.status(500).json({ error: "Search failed" })
  }
})

export default router