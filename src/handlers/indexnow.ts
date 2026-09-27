import type { VercelRequest, VercelResponse } from "@vercel/node"
import crypto from "crypto"

// IndexNow key file (https://www.indexnow.org): lets search engines confirm that submissions for
// api.actuent.ai come from us. actuent-crawler/indexnow.ts derives the same key.
export function indexNowKey(): string {
  return crypto.createHash("sha256").update(`indexnow:${process.env.SUPABASE_SERVICE_KEY || ""}`).digest("hex").slice(0, 32)
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8")
  res.setHeader("Cache-Control", "public, max-age=86400")
  return res.status(200).send(indexNowKey())
}
