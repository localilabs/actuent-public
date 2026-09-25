import type { VercelRequest, VercelResponse } from "@vercel/node"

// Actuent's own LAWP. The endpoint on suggest_site makes it executable by agents through
// actuent_execute_action, and it doubles as the reference example of a LAWP action.
export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Content-Type", "application/json")

  return res.status(200).json({
    protocol: "LAWP",
    version: "0.2.0",
    spec: "https://github.com/localilabs/lawp",
    domain: "api.actuent.ai",
    name: "Actuent",
    pages: {
      "/": {
        title: "Actuent — The Internet for AI",
        content: "Actuent is a search engine for AI agents. It returns websites as LAWP: structured JSON with each site's pages and the actions a visitor can take."
      }
    },
    actions: [
      {
        id: "suggest_site",
        name: "Suggest a site",
        description: "Ask Actuent to add a website to the LAWP index.",
        intent: ["suggest site", "add site", "index website", "submit domain"],
        input: { type: "text", required: true },
        endpoint: { url: "https://api.actuent.ai/api/suggest", method: "POST" }
      }
    ],
    search: "https://api.actuent.ai/api/search",
    mcp: "https://agents.actuent.ai/api/mcp",
    docs: "https://docs.actuent.ai",
    register: "https://api.actuent.ai/api/register"
  })
}
