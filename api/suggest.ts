import type { VercelRequest, VercelResponse } from "@vercel/node"
import { verifyActuentRequest } from "../src/utils/verify-actuent"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  if (req.method === "OPTIONS") return res.status(200).end()

  if (req.method === "GET") {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Suggest a Site — Actuent</title>
<link rel="icon" type="image/png" href="https://api.actuent.ai/assets/actuent-logo.png">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#0a0a0a; color:#f0f0f0; font-family:-apple-system,sans-serif; min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px 20px; }
img { height:24px; margin-bottom:40px; }
.box { background:#0f0f0f; border:1px solid #1c1c1c; border-radius:12px; padding:32px; width:100%; max-width:420px; }
h1 { font-size:18px; font-weight:600; margin-bottom:6px; }
p { color:#555; font-size:13px; margin-bottom:24px; line-height:1.5; }
label { font-size:11px; color:#444; text-transform:uppercase; letter-spacing:1px; display:block; margin-bottom:6px; }
input { width:100%; background:#181818; border:1px solid #1c1c1c; color:#f0f0f0; padding:10px 14px; font-size:13px; font-family:'Courier New',monospace; border-radius:7px; margin-bottom:16px; outline:none; }
input:focus { border-color:#333; }
button { width:100%; background:#f0f0f0; color:#0a0a0a; border:none; padding:11px; font-size:13px; font-weight:700; border-radius:7px; cursor:pointer; }
button:hover { opacity:0.85; }
.success { color:#4ade80; font-size:13px; margin-top:12px; display:none; }
.error { color:#f87171; font-size:13px; margin-top:12px; display:none; }
</style>
</head>
<body>
<img src="https://api.actuent.ai/assets/actuent-logo.png" alt="Actuent">
<div class="box">
  <h1>Suggest a site</h1>
  <p>Know a site that should be on Actuent? Submit it and we'll add it to the LAWP index.</p>
  <label>Domain</label>
  <input type="text" id="domain" placeholder="yoursite.com" />
  <label>Your email (optional)</label>
  <input type="email" id="email" placeholder="you@example.com" />
  <button onclick="submit()">Submit site</button>
  <div class="success" id="success">Thanks! We'll add it to the index soon.</div>
  <div class="error" id="error">Something went wrong — try again.</div>
</div>
<script>
async function submit() {
  const domain = document.getElementById("domain").value.trim().toLowerCase().replace(/^https?:\/\//,"").replace(/\/.*/,"")
  const email = document.getElementById("email").value.trim()
  if (!domain || !domain.includes(".")) { document.getElementById("error").style.display="block"; return }
  const res = await fetch("/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain, submitted_by: email || null })
  })
  if (res.ok) {
    document.getElementById("success").style.display = "block"
    document.getElementById("error").style.display = "none"
    document.getElementById("domain").value = ""
    document.getElementById("email").value = ""
  } else {
    document.getElementById("error").style.display = "block"
  }
}
</script>
</body>
</html>`
    res.setHeader("Content-Type", "text/html")
    return res.status(200).send(html)
  }

  if (req.method === "POST") {
    // Accepts the suggest form ({ domain }) and LAWP action calls ({ action: "suggest_site", input }).
    const body = req.body || {}
    if (body.action === "suggest_site") {
      // LAWP action calls must be signed by Actuent. The body is re-serialised exactly as Actuent sent it.
      const signed = await verifyActuentRequest(req.headers, "POST", "https://api.actuent.ai/api/suggest", JSON.stringify(body))
      if (!signed) return res.status(401).json({ error: "Invalid Actuent signature" })
      if (body.test === true) return res.status(200).json({ success: true, test: true, message: "Test request received and verified — nothing was saved" })
    }
    const lawpInput = body.action === "suggest_site" ? body.input : undefined
    const domain = typeof lawpInput === "string" ? lawpInput : lawpInput?.domain ?? body.domain
    const submitted_by = body.submitted_by
    if (typeof domain !== "string" || !domain.includes(".")) {
      return res.status(400).json({ error: "Invalid domain" })
    }
    const clean = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*/, "").trim()

    await fetch(`${SUPABASE_URL}/rest/v1/site_suggestions`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ domain: clean, submitted_by: submitted_by || null })
    })

    return res.status(200).json({ success: true, domain: clean })
  }

  return res.status(405).end()
}