import type { VercelRequest, VercelResponse } from "@vercel/node"
import { sites } from "../src/data/sites"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  const { domain, name, pages, actions } = req.body

  if (!domain || !name || !pages || !actions) {
    return res.status(400).json({ error: "Missing required fields: domain, name, pages, actions" })
  }

  sites[domain] = { domain, name, pages, actions }

  return res.status(200).json({
    success: true,
    message: `${domain} registered on Actuent`,
    domain
  })
}
