import type { VercelRequest, VercelResponse } from "@vercel/node"
import { getLatestDiff } from "../utils/diff"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  if (req.method === "OPTIONS") return res.status(200).end()

  const domain = (req.query.domain as string || "").trim()

  if (!domain) {
    return res.status(400).json({ error: "Missing ?domain=yourdomain.com" })
  }

  const diff = await getLatestDiff(domain)

  if (!diff) {
    return res.status(200).json({
      domain,
      status: "no_changes_detected",
      message: "No diffs found — site either hasn't been recrawled yet or hasn't changed"
    })
  }

  return res.status(200).json({
    domain,
    detected_at: diff.detected_at,
    changes: diff.changes
  })
}
