import { randomBytes } from "crypto"
import { sendEmail } from "./email"
import { readPage } from "./read_page"

// Messages from AI assistants to businesses (MCP actuent_contact_business, Pro): a question ("do you
// have gluten-free options?"), a message, or, for businesses that claimed their site on Actuent, a
// booking request with Accept/Decline buttons. Sent by email from Actuent with the user's own address
// as reply-to, so the business answers the person directly. The user gets a receipt.
// Guard rails: only to the business's own published address (its structured data, or an address on
// its own domain), a daily cap per sender and per business, and a one-click opt-out for businesses.
// Needs list_thirtyone.sql.

const SUPABASE_URL = process.env.SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": KEY, "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" }
const BASE = "https://api.actuent.ai"
const PER_SENDER_PER_DAY = 10, PER_BUSINESS_PER_DAY = 20

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i
const bare = (d: string) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "")

async function rows(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS, signal: AbortSignal.timeout(6000) }).catch(() => null)
  return r?.ok ? r.json() : []
}
async function count(path: string): Promise<number> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: "HEAD", headers: { ...HEADERS, "Prefer": "count=exact", "Range": "0-0" } }).catch(() => null)
  return Number(r?.headers.get("content-range")?.split("/")[1] || 0)
}

// Where the business wants to be reached: its claimed owner (bookings), its own structured data, or an
// address on its own domain found on its homepage.
async function businessEmail(domain: string, claimedOnly: boolean): Promise<{ email: string, claimed: boolean } | null> {
  const [site] = await rows(`lawp_sites?select=owner_key,business&domain=eq.${encodeURIComponent(domain)}`)
  if (site?.owner_key) {
    const [owner] = await rows(`api_keys?select=email&key_hash=eq.${site.owner_key}`)
    if (owner?.email) return { email: owner.email, claimed: true }
  }
  if (claimedOnly) return null
  const own = String(site?.business?.email || "").trim()
  if (EMAIL.test(own)) return { email: own, claimed: false }
  const page: any = (await readPage(`https://${domain}/`).catch(() => null))?.body
  const found = (page?.actions || []).find((a: any) => a.type === "email" && EMAIL.test(a.email || ""))?.email
  if (found && bare(found.split("@")[1]).endsWith(domain)) return { email: found, claimed: false }
  return null
}

export async function sendBusinessMessage(input: any, senderKeyHash: string): Promise<{ status: number, body: any }> {
  const domain = bare(String(input?.domain || ""))
  const kind = ["question", "message", "booking_request"].includes(input?.kind) ? input.kind : "question"
  const text = String(input?.text || "").replace(/\s+\n/g, "\n").trim().slice(0, 2000)
  const replyTo = String(input?.reply_to || "").trim()
  const name = String(input?.from_name || "").trim().slice(0, 80)
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return { status: 400, body: { error: "Give the business's website (domain)" } }
  if (text.length < 5) return { status: 400, body: { error: "Write the message (what to ask or say)" } }
  if (!EMAIL.test(replyTo)) return { status: 400, body: { error: "The user's email address is needed (reply_to), so the business can answer them" } }
  if ((await rows(`business_optouts?select=domain&domain=eq.${encodeURIComponent(domain)}`)).length) return { status: 200, body: { sent: false, reason: `${domain} has asked not to receive messages through Actuent. The user can contact them on their website.` } }
  const day = encodeURIComponent(new Date(Date.now() - 86400_000).toISOString())
  if (await count(`action_messages?select=id&api_key=eq.${senderKeyHash}&created_at=gte.${day}`) >= PER_SENDER_PER_DAY) return { status: 429, body: { sent: false, reason: `That's ${PER_SENDER_PER_DAY} messages today, the daily limit. Try again tomorrow.` } }
  if (await count(`action_messages?select=id&domain=eq.${encodeURIComponent(domain)}&created_at=gte.${day}`) >= PER_BUSINESS_PER_DAY) return { status: 429, body: { sent: false, reason: `${domain} has had many messages through Actuent today. The user can contact them on their website.` } }
  const to = await businessEmail(domain, kind === "booking_request")
  if (!to) return { status: 200, body: { sent: false, reason: kind === "booking_request"
    ? `${domain} doesn't take booking requests through Actuent (only businesses that claimed their site do). Use its booking link or phone instead.`
    : `Actuent couldn't find an email address that ${domain} publishes. The user can use the contact page on its website.` } }

  const details = kind === "booking_request" ? { date: String(input?.date || "").slice(0, 20), time: String(input?.time || "").slice(0, 10), party_size: Number(input?.party_size) || null } : null
  const token = randomBytes(18).toString("base64url")
  const saved = await fetch(`${SUPABASE_URL}/rest/v1/action_messages`, {
    method: "POST", headers: { ...HEADERS, "Prefer": "return=minimal" },
    body: JSON.stringify({ token, api_key: senderKeyHash, domain, kind, to_email: to.email, from_name: name || null, reply_to: replyTo, body: text, details })
  }).catch(() => null)
  if (!saved?.ok) return { status: 503, body: { sent: false, reason: "Messages aren't available yet (list_thirtyone.sql)" } }

  const who = name ? `${esc(name)} (${esc(replyTo)})` : esc(replyTo)
  const what = kind === "booking_request" ? "a booking request" : kind === "question" ? "a question" : "a message"
  const booking = details ? `<p><strong>${esc(details.date)}${details.time ? ` at ${esc(details.time)}` : ""}${details.party_size ? `, ${details.party_size} ${details.party_size === 1 ? "person" : "people"}` : ""}</strong></p>
<p><a href="${BASE}/api/search?msg_reply=${token}&answer=accept" style="background:#3fb950;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none">Accept</a> &nbsp; <a href="${BASE}/api/search?msg_reply=${token}&answer=decline" style="background:#444;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none">Decline</a></p>` : ""
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;color:#1a1a1a">
<p>${who} sent ${what} for ${esc(domain)} through their AI assistant:</p>
<blockquote style="border-left:3px solid #ff8a3d;margin:12px 0;padding:4px 14px;white-space:pre-wrap">${esc(text)}</blockquote>${booking}
<p>Just reply to this email to answer them${details ? " (or use the buttons)" : ""}.</p>
<p style="color:#777;font-size:12px">Sent by Actuent, which helps AI assistants find and contact businesses. ${to.claimed ? "You see these in Actuent Analytics → Inbox too." : `Don't want messages like this? <a href="${BASE}/api/search?msg_optout=${encodeURIComponent(domain)}&t=${token}">Stop messages for ${esc(domain)}</a>.`}</p></div>`
  const ok = await sendEmail(to.email, `${kind === "booking_request" ? "Booking request" : kind === "question" ? "Question" : "Message"} from ${name || replyTo} via their AI assistant`, html, replyTo)
  if (!ok) return { status: 503, body: { sent: false, reason: "The email couldn't be sent just now. Try again in a minute." } }
  // Receipt for the user: what was sent, to whom, and what happens next.
  await sendEmail(replyTo, `Sent: your ${what.replace(/^an? /, "")} to ${domain}`, `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px"><p>Your AI assistant sent this to <strong>${esc(domain)}</strong> through Actuent:</p><blockquote style="border-left:3px solid #ff8a3d;margin:12px 0;padding:4px 14px;white-space:pre-wrap">${esc(text)}</blockquote>${details ? `<p>${esc(details.date)} ${esc(details.time)}${details.party_size ? `, ${details.party_size} people` : ""}. You'll get an email when they accept or decline.</p>` : "<p>They'll answer you by email, at this address.</p>"}<p style="color:#777;font-size:12px">Didn't mean to? Reply to this email and tell us.</p></div>`)
  return { status: 200, body: { sent: true, to: domain, kind, status_token: token, ...(details ? { booking: details, next: "The business accepts or declines; the user gets an email either way." } : { next: "The business answers the user by email." }) } }
}

// Accept/Decline links from booking requests (and status checks with the same token).
export async function answerMessage(token: string, answer: string): Promise<string> {
  const [m] = await rows(`action_messages?select=id,domain,kind,status,reply_to,from_name,details&token=eq.${encodeURIComponent(token)}`)
  if (!m) return "This link isn't valid any more."
  if (m.kind !== "booking_request" || !["accept", "decline"].includes(answer)) return "Nothing to answer here."
  if (m.status !== "sent") return `You already ${m.status} this request.`
  const status = answer === "accept" ? "accepted" : "declined"
  await fetch(`${SUPABASE_URL}/rest/v1/action_messages?id=eq.${m.id}`, { method: "PATCH", headers: HEADERS, body: JSON.stringify({ status, answered_at: new Date().toISOString() }) })
  const d = m.details || {}
  await sendEmail(m.reply_to, `${m.domain} ${status} your booking request`, `<div style="font-family:-apple-system,Segoe UI,sans-serif"><p><strong>${esc(m.domain)}</strong> ${status} your request for ${esc(d.date)} ${esc(d.time)}${d.party_size ? `, ${d.party_size} people` : ""}.</p>${status === "accepted" ? "<p>See you there! Reply to their email if anything changes.</p>" : "<p>Your AI assistant can help find another time or place.</p>"}</div>`)
  return status === "accepted" ? "Accepted. We've let them know." : "Declined. We've let them know."
}

export async function optOut(domain: string, token: string): Promise<string> {
  const [m] = await rows(`action_messages?select=domain&token=eq.${encodeURIComponent(token)}`)
  if (!m || m.domain !== bare(domain)) return "This link isn't valid."
  await fetch(`${SUPABASE_URL}/rest/v1/business_optouts?on_conflict=domain`, { method: "POST", headers: { ...HEADERS, "Prefer": "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ domain: m.domain }) })
  return `Done: ${m.domain} won't get messages through Actuent any more.`
}

export async function messageStatus(token: string): Promise<any> {
  const [m] = await rows(`action_messages?select=domain,kind,status,created_at,answered_at,details&token=eq.${encodeURIComponent(token)}`)
  return m || { error: "Unknown status token" }
}
