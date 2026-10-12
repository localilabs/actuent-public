// "Add to calendar" for an event Actuent knows: /api/search?ics=<event url> returns a calendar file
// (works in Apple Calendar, Outlook, Google Calendar import). Looked up by the event's own URL.

const SUPABASE_URL = process.env.SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_KEY!
const HEADERS = { "apikey": KEY, "Authorization": `Bearer ${KEY}` }

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
const esc = (s: string) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n")
// Lines longer than 75 bytes are folded (RFC 5545).
const fold = (line: string) => line.length <= 74 ? line : line.match(/.{1,73}/g)!.join("\r\n ")

// The next time this event is on (a URL can list a recurring event); { over: true } when it has been.
async function find(url: string): Promise<any | null> {
  if (!/^https?:\/\//.test(url)) return null
  const now = encodeURIComponent(new Date(Date.now() - 6 * 3600_000).toISOString())
  const r = await fetch(`${SUPABASE_URL}/rest/v1/lawp_events?select=name,url,start_date,end_date,venue,city,description&url=eq.${encodeURIComponent(url)}&or=(start_date.gte.${now},end_date.gte.${now})&order=start_date.asc&limit=1`, { headers: HEADERS, signal: AbortSignal.timeout(5000) }).catch(() => null)
  const [e] = r?.ok ? await r.json() : []
  if (e?.start_date) return e
  // Not on again: "over" only if Actuent knew this event (it may already have been cleared out).
  const k = await fetch(`${SUPABASE_URL}/rest/v1/lawp_events?select=url&url=eq.${encodeURIComponent(url)}&limit=1`, { headers: HEADERS, signal: AbortSignal.timeout(5000) }).catch(() => null)
  const [known] = k?.ok ? await k.json() : []
  return known ? { over: true } : null
}
export const isOver = (e: any) => !!e?.over
// Listings with only a date (no time) become all-day calendar entries.
const dateOnly = (e: any) => /Time: see the listing/.test(String(e.description || ""))
const day = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "")

// &to=google: Google Calendar's "add event" page for it instead of a file (keeps event answers short).
export async function googleCalendarUrl(url: string): Promise<string | { over: true } | null> {
  const e = await find(url)
  if (!e || e.over) return e
  const start = new Date(e.start_date), end = e.end_date ? new Date(e.end_date) : new Date(start.getTime() + 2 * 3600_000)
  const dates = dateOnly(e) ? `${day(start)}/${day(new Date(start.getTime() + 86400_000))}` : `${stamp(start)}/${stamp(end)}`
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.name)}&dates=${dates}&location=${encodeURIComponent([e.venue, e.city].filter(Boolean).join(", "))}&details=${encodeURIComponent(`Tickets and details: ${e.url}`)}`
}

export async function eventIcs(url: string): Promise<string | { over: true } | null> {
  const e = await find(url)
  if (!e || e.over) return e
  const start = new Date(e.start_date), end = e.end_date ? new Date(e.end_date) : new Date(start.getTime() + 2 * 3600_000)
  const where = [e.venue, e.city].filter(Boolean).join(", ")
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Actuent//Events//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:${Buffer.from(e.url).toString("base64url").slice(0, 60)}@actuent.ai`, `DTSTAMP:${stamp(new Date())}`,
    ...(dateOnly(e) ? [`DTSTART;VALUE=DATE:${day(start)}`, `DTEND;VALUE=DATE:${day(new Date(start.getTime() + 86400_000))}`] : [`DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`]), `SUMMARY:${esc(e.name)}`,
    ...(where ? [`LOCATION:${esc(where)}`] : []), `URL:${e.url}`,
    `DESCRIPTION:${esc(`${String(e.description || "").replace(/\s*Genre: [^.]+\.\s*$/, "").slice(0, 400)}\n\nTickets and details: ${e.url}\nFound with Actuent`)}`,
    "END:VEVENT", "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n"
}
