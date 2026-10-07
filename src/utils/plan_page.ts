import { createHmac, timingSafeEqual } from "crypto"

// The page behind a plan's share link (actuent-private src/tools/plan.ts): stops with times, a map
// link for each and one walking route through all of them. The plan is in the link and signed with
// the key both servers share, so only plans Actuent made can be shown.

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))

export function planPage(data: string, sig: string): string | null {
  const want = createHmac("sha256", process.env.ACTUENT_INTERNAL_KEY || "actuent").update(data).digest("base64url").slice(0, 22)
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null
  let plan: { t: string, s: [string, string, string, string, string][] }
  try { plan = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) } catch { return null }
  if (!Array.isArray(plan?.s) || !plan.s.length) return null
  const where = (x: string[]) => encodeURIComponent([x[2], x[3]].filter(Boolean).join(", "))
  const route = `https://www.google.com/maps/dir/${plan.s.map(where).join("/")}/data=!4m2!4m1!3e2`
  const stops = plan.s.map(x => {
    const site = /^https?:\/\//.test(x[4] || "") ? x[4] : ""
    return `<li><span class="t">${esc(x[0])}</span><div><strong>${esc(x[2])}</strong> <span class="k">${esc(x[1])}</span><br><span class="a">${esc(x[3])}</span><br>
<a href="https://www.google.com/maps/search/?api=1&query=${where(x)}">Map</a>${site ? ` · <a href="${esc(site)}" rel="nofollow noopener">Website</a>` : ""}</div></li>`
  }).join("")
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(plan.t)} — plan made with Actuent</title><meta name="robots" content="noindex">
<meta property="og:title" content="${esc(plan.t)}"><meta property="og:description" content="${esc(plan.s.map(x => `${x[0]} ${x[2]}`).join(" → "))}">
<meta property="og:image" content="https://api.actuent.ai/og?v=2&title=${encodeURIComponent(plan.t)}&subtitle=${encodeURIComponent(plan.s.map(x => x[2]).join(" → ").slice(0, 120))}&tag=actuent.ai&lawpy=wave"><meta name="twitter:card" content="summary_large_image">
<style>body{background:#0a0a0a;color:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:28px 16px}main{max-width:560px;margin:0 auto}
h1{font-size:24px;margin:0 0 4px}p{color:#a8a8b6}ol{list-style:none;padding:0;margin:20px 0}li{display:flex;gap:14px;padding:14px 0;border-bottom:1px solid #2a2a34}
.t{color:#ff8a3d;font-weight:700;min-width:48px}.k{color:#a8a8b6;font-size:13px}.a{color:#c4c4cf;font-size:13px}a{color:#ff8a3d}
.btn{display:inline-block;background:#ff8a3d;color:#111;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600}</style></head>
<body><main><h1>${esc(plan.t)}</h1><p>A plan made by an AI assistant with Actuent. Opening hours can change, so check before you go.</p>
<ol>${stops}</ol><a class="btn" href="${route}">Walking route through every stop →</a>
<p style="margin-top:28px;font-size:13px">Want your AI to plan like this? <a href="https://docs.actuent.ai/connect">Connect Actuent</a> (free).</p></main></body></html>`
}
