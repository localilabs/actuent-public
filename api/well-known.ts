import type { VercelRequest, VercelResponse } from "@vercel/node"

// Actuent's own LAWP. The endpoint on suggest_site makes it executable by agents through
// actuent_execute_action, and it doubles as the reference example of a LAWP action.
export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Content-Type", "application/json")

  res.setHeader("Cache-Control", "public, max-age=3600")
  // LAWP 0.4 reference document.
  return res.status(200).json({
    lawp_version: "0.4",
    domain: "api.actuent.ai",
    name: "Actuent",
    language: "en",
    updated_at: "2026-09-27T00:00:00Z",
    ttl: 3600,
    pages: {
      "/": {
        title: "Actuent — The Internet for AI",
        content: "Actuent is a search engine for AI agents. It returns websites as LAWP: structured JSON with each site's pages and the actions a visitor can take."
      },
      "/site": {
        title: "Agent-ready websites",
        content: "A directory of websites AI agents can read and act on, with each site's agent-readiness score, by city and category."
      }
    },
    actions: [
      {
        id: "suggest_site",
        name: "Suggest a site",
        description: "Ask Actuent to add a website to the LAWP index. Indexing can take a while, so this returns a status URL to check.",
        intent: ["suggest site", "add site", "index website", "submit domain"],
        input: { type: "object", required: true, fields: [{ name: "domain", type: "string", required: true, description: "The site's domain, e.g. example.com", example: "example.com" }] },
        endpoint: { url: "https://api.actuent.ai/api/suggest", method: "POST" },
        output: { fields: [
          { name: "domain", type: "string" },
          { name: "status", type: "enum", options: ["indexed", "pending"], description: "indexed: it's already on Actuent; pending: queued, check status_url" },
          { name: "page", type: "url", description: "The site's Actuent page, once indexed" }
        ] },
        modes: ["execute", "quote"],
        safety: { requires_confirmation: false, costs_money: false, reversible: true, destructive: false },
        account: "none"
      }
    ]
  })
}