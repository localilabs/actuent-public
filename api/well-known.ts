import type { VercelRequest, VercelResponse } from "@vercel/node"

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Content-Type", "application/json")

  return res.status(200).json({
    protocol: "LAWP",
    version: "0.1.0",
    spec: "https://github.com/localilabs/lawp",
    search: "https://api.actuent.ai/api/search",
    mcp: "https://agents.actuent.ai/api/mcp",
    docs: "https://docs.actuent.ai",
    register: "https://api.actuent.ai/api/register"
  })
}
