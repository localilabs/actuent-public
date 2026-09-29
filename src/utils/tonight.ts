import { TIME_ZONES } from "./business"
import { cityCountry } from "./local"

// "Tonight" in a city: from now (or 4 pm local, if it's earlier in the day) until 5 am local.
// Used by /api/tonight and the humans page's "What's on tonight" chip.

// A local date and time ("2026-10-03", "19:00") in a time zone, as an absolute Date.
export function localToUtc(date: string, time: string, zone: string): Date {
  const [y, mo, d] = date.split("-").map(Number), [h, mi] = time.split(":").map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(guess)).map(p => [p.type, p.value]))
  const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute))
  return new Date(guess - (shown - guess))
}

export function zoneForCity(city: string | null | undefined, country?: string | null): string {
  const code = (country || cityCountry(city) || "").toUpperCase()
  return TIME_ZONES[code] || "Europe/Copenhagen"
}

export function tonightWindow(zone: string, now = new Date()): { from: Date, to: Date } {
  const localDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hour12: false }).format(now)) % 24
  // After midnight, "tonight" is still the night that began yesterday.
  const today = localDay(now), tomorrow = localDay(new Date(now.getTime() + 86400000))
  const end = hour < 5 ? localToUtc(today, "05:00", zone) : localToUtc(tomorrow, "05:00", zone)
  const evening = localToUtc(today, "16:00", zone)
  const from = new Date(Math.max(now.getTime() - 30 * 60000, hour < 5 ? 0 : evening.getTime()))
  return { from, to: end }
}

// A time as people there would read it, e.g. "19:30".
export function localTime(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso))
}
