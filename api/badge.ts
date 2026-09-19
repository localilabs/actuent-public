import type { VercelRequest, VercelResponse } from "@vercel/node"

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Content-Type", "image/svg+xml")
  res.setHeader("Cache-Control", "public, max-age=86400")

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="20">
  <rect width="120" height="20" rx="3" fill="#0a0a0a"/>
  <rect x="80" width="40" height="20" rx="3" fill="#f0f0f0"/>
  <text x="6" y="14" font-family="-apple-system,sans-serif" font-size="11" fill="#f0f0f0">LAWP ready</text>
  <text x="84" y="14" font-family="-apple-system,sans-serif" font-size="11" fill="#0a0a0a" font-weight="bold">✓</text>
</svg>`

  return res.status(200).send(svg)
}
