// "Add to calendar" for an event Actuent knows: /api/search?ics=<event url> returns a calendar file
// (works in Apple Calendar, Outlook, Google Calendar import). Looked up by the event's own URL.

const SUPABASE_URL = process.env.SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": KEY, "Authorization": `Bearer ${KEY}` }

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
const esc = (s: string) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n")
// Lines longer than 75 bytes are folded (RFC 5545).
const fold = (line: string) => line.length <= 74 ? line : line.match(/.{1,73}/g)!.join("\r\n ")

export async function eventIcs(url: string): Promise<string | null> {
  if (!/^https?:\/\//.test(url)) return null
  const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_events?select=name,url,start_date,end_date,venue,city,description&url=eq.${encodeURIComponent(url)}&limit=1`, { headers: HEADERS, signal: AbortSignal.timeout(5000) }).catch(() => null)
  const [e] = r?.ok ? await r.json() : []
  if (!e?.start_date) return null
  const start = new Date(e.start_date), end = e.end_date ? new Date(e.end_date) : new Date(start.getTime() + 2 * 3600_000)
  const where = [e.venue, e.city].filter(Boolean).join(", ")
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Actuent//Events//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:${Buffer.from(e.url).toString("base64url").slice(0, 60)}@actuent.ai`, `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${esc(e.name)}`,
    ...(where ? [`LOCATION:${esc(where)}`] : []), `URL:${e.url}`,
    `DESCRIPTION:${esc(`${String(e.description || "").replace(/\s*Genre: [^.]+\.\s*$/, "").slice(0, 400)}\n\nTickets and details: ${e.url}\nFound with Actuent`)}`,
    "END:VEVENT", "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n"
}
