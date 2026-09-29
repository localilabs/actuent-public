import type { VercelRequest, VercelResponse } from "@vercel/node"
import { verifyAgentRequest } from "../src/utils/verify-actuent"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

function cleanDomain(value: string): string | null {
  const d = value.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*/, "").trim()
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null
}

async function indexed(domain: string): Promise<boolean> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_sites?select=domain&domain=eq.${encodeURIComponent(domain)}&actions=neq.%5B%5D`, {
      headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` }
    })
    return r.ok && (await r.json()).length > 0
  } catch { return false }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  if (req.method === "OPTIONS") return res.status(200).end()

  // LAWP 0.4 long-running action: the status of a suggestion (signed GET from the agent).
  if (req.method === "GET" && req.query.status) {
    const signed = await verifyAgentRequest(req.headers as any, "GET", `https://api.actuent.ai${req.url}`, "")
    if (!signed) return res.status(401).json({ error: { code: "invalid_signature", message: "Sign the request (HTTP Message Signatures or Actuent's headers)" } })
    const domain = cleanDomain(String(req.query.status))
    if (!domain) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid domain", field: "status" } })
    return res.status(200).json(await indexed(domain)
      ? { status: "completed", result: { domain, status: "indexed", page: `https://api.actuent.ai/site/${domain}` } }
      : { status: "pending", retry_after_seconds: 3600 })
  }

  if (req.method === "GET") {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Suggest a Site — Actuent</title>
<link rel="icon" type="image/png" href="https://api.actuent.ai/assets/actuent-logo.png">
<script src="/assets/lawpy.js" defer></script>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#0a0a0a; color:#f0f0f0; font-family:-apple-system,sans-serif; min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px 20px; }
img { height:24px; margin-bottom:28px; }
#lawpy { margin-bottom:16px; }
.box { background:#13131a; border:1px solid #2a2a34; border-radius:12px; padding:32px; width:100%; max-width:420px; }
h1 { font-size:18px; font-weight:600; margin-bottom:6px; }
p { color:#a8a8b6; font-size:13px; margin-bottom:24px; line-height:1.5; }
label { font-size:11px; color:#a8a8b6; text-transform:uppercase; letter-spacing:1px; display:block; margin-bottom:6px; }
input { width:100%; background:#1c1c25; border:1px solid #2a2a34; color:#f0f0f0; padding:10px 14px; font-size:13px; font-family:'Courier New',monospace; border-radius:7px; margin-bottom:16px; outline:none; }
input:focus { border-color:#45454f; }
button { width:100%; background:#ff8a3d; color:#0a0a0a; border:none; padding:11px; font-size:13px; font-weight:700; border-radius:7px; cursor:pointer; }
button:hover { opacity:0.85; }
.success { color:#4ade80; font-size:13px; margin-top:12px; display:none; }
.error { color:#f87171; font-size:13px; margin-top:12px; display:none; }
</style>
</head>
<body>
<img src="https://api.actuent.ai/assets/actuent-logo.png" alt="Actuent">
<lawpy-mascot id="lawpy" scale="4"></lawpy-mascot>
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
  // Lawpy thinks while it's sent, and dances when the site is accepted.
  const lawpy = (state, loops) => { const el = document.getElementById("lawpy"); if (el && el.play) el.play(state, loops ? { loops, then: "idle" } : {}) }
  lawpy("think")
  const res = await fetch("/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain, submitted_by: email || null })
  })
  lawpy(res.ok ? "dance" : "idle", res.ok ? 3 : 0)
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
    // As a LAWP action this is Actuent's reference implementation of LAWP 0.4: signed requests
    // (RFC 9421 or Actuent's headers), standard errors, quotes, test mode and a long-running result.
    const body = req.body || {}
    const isAction = body.action === "suggest_site"
    if (isAction) {
      // The body is re-serialised exactly as the agent sent it (compact JSON).
      const signed = await verifyAgentRequest(req.headers as any, "POST", "https://api.actuent.ai/api/suggest", JSON.stringify(body))
      if (!signed) return res.status(401).json({ error: { code: "invalid_signature", message: "Sign the request (HTTP Message Signatures or Actuent's headers)" } })
      // Quotes never change anything, so they're answered normally even in test mode.
      if (body.test === true && body.mode !== "quote") return res.status(200).json({ success: true, test: true, verified_with: signed, message: "Test request received and verified — nothing was saved" })
    }
    const lawpInput = isAction ? body.input : undefined
    const domain = typeof lawpInput === "string" ? lawpInput : lawpInput?.domain ?? body.domain
    const submitted_by = body.submitted_by
    const clean = typeof domain === "string" ? cleanDomain(domain) : null
    if (!clean) {
      return res.status(400).json(isAction ? { error: { code: "invalid_input", message: "Give a domain like example.com", field: "domain" } } : { error: "Invalid domain" })
    }
    const already = await indexed(clean)
    if (isAction && body.mode === "quote") {
      // Suggesting is free; the quote says whether it's needed at all.
      return res.status(200).json({ quote: { available: !already, price: 0, currency: "EUR" }, already_indexed: already, ...(already ? { page: `https://api.actuent.ai/site/${clean}` } : {}) })
    }
    if (isAction && already) return res.status(200).json({ domain: clean, status: "indexed", page: `https://api.actuent.ai/site/${clean}` })

    await fetch(`${SUPABASE_URL}/rest/v1/site_suggestions`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ domain: clean, submitted_by: submitted_by || null })
    })

    if (isAction) return res.status(202).json({ status: "pending", status_url: `https://api.actuent.ai/api/suggest?status=${encodeURIComponent(clean)}`, retry_after_seconds: 3600, domain: clean })
    return res.status(200).json({ success: true, domain: clean })
  }

  return res.status(405).end()
}