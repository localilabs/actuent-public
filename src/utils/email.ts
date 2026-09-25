// Transactional email via Resend (free tier). Off unless RESEND_API_KEY is set.
// EMAIL_FROM must be an address on a domain verified in Resend, e.g. "Actuent <hello@actuent.ai>".

const RESEND_API_KEY = process.env.RESEND_API_KEY
const EMAIL_FROM = process.env.EMAIL_FROM || "Actuent <hello@actuent.ai>"

function esc(v: string) { return v.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)) }

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY || !to) return false
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html, reply_to: "support@localilabs.com" })
    })
    if (!r.ok) console.error("email failed:", r.status, await r.text())
    return r.ok
  } catch (e) { console.error("email failed:", e); return false }
}

// Sent once, when someone claims a site on Actuent.
export function welcomeEmail(domain: string): { subject: string, html: string } {
  const d = esc(domain)
  const page = `https://api.actuent.ai/site/${d}`
  return {
    subject: `${domain} is live on Actuent`,
    html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;line-height:1.6">
<h2 style="margin:0 0 12px">${d} is live on Actuent 🎉</h2>
<p>You've claimed <strong>${d}</strong>. AI agents using Actuent (in ChatGPT, Claude and other apps) now see the version you control.</p>
<p><a href="${page}" style="display:inline-block;background:#ff8a3d;color:#0a0a0a;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">See what AI agents see →</a></p>
<p><strong>Next steps</strong></p>
<ol>
<li>Edit your pages and actions any time in <a href="https://analytics.actuent.ai">Analytics → My sites</a>.</li>
<li>Make actions executable (bookings, enquiries) by publishing them in your own <code>/.well-known/lawp.json</code>. On WordPress or Cloudflare it's one click: <a href="https://docs.actuent.ai/#platforms">docs.actuent.ai</a>.</li>
<li>Show your agent-readiness score on your site:<br><code>&lt;img src="https://api.actuent.ai/badge.svg?domain=${d}"&gt;</code></li>
</ol>
<p>Questions? Just reply to this email.</p>
<p style="color:#666;font-size:13px">Actuent, made by localilabs · You got this email because you claimed ${d} on Actuent.</p>
</div>`
  }
}
