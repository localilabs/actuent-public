import type { VercelRequest, VercelResponse } from "@vercel/node"

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Content-Type", "image/svg+xml")
  res.setHeader("Cache-Control", "public, max-age=86400")

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="160" height="56">
  <rect width="160" height="56" rx="8" fill="#0a0a0a" stroke="#1c1c1c" stroke-width="1"/>
  <image href="https://api.actuent.ai/assets/actuent-logo.png" x="12" y="10" width="36" height="36"/>
  <text x="56" y="22" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="10" fill="#555">Listed on</text>
  <text x="56" y="40" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="16" font-weight="700" fill="#f0f0f0">Actuent</text>
</svg>`

  return res.status(200).send(svg)
}
