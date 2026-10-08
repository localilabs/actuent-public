// Same as actuent-private src/tools/events.ts (keep in sync).
// The same event listed twice, by the venue and by a ticket seller (or a city guide): one entry, from
// the venue's own site when it's one of them, with the other listings' links kept as also_listed_at.
// Same event = same main name (before "+ support", "w/", ":" or brackets) on the same day, in the same
// city (or one has no city).
function nameKey(name: string): string {
  return String(name || "").toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .split(/\s+(?:[-–—+|:]|w\/|with|support|feat\.?|ft\.?|presents|live at|at)\s+/)[0]
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\b(live|concert|koncert|tickets?|billetter|tour \d{4}|\d{4} tour)\b/g, " ").replace(/[^a-z0-9]+/g, "")
}
export function mergeDuplicates(rows: any[]): any[] {
  const out: any[] = [], byKey = new Map<string, any[]>()
  const own = (e: any) => { const root = String(e.domain || "").replace(/^www\./, "").split(".")[0].replace(/[^a-z0-9]/g, ""); return root.length >= 4 && String(e.venue || "").toLowerCase().replace(/[^a-z0-9]/g, "").includes(root) }
  const filled = (e: any) => ["price", "description", "venue", "city", "end_date"].filter(k => e[k] != null && e[k] !== "").length
  for (const e of rows) {
    const k = nameKey(e.name)
    const key = k.length >= 4 ? `${k}|${String(e.start_date || "").slice(0, 10)}` : `${e.url}|${e.start_date}`
    const same = (byKey.get(key) || []).find(x => !x.city || !e.city || String(x.city).toLowerCase() === String(e.city).toLowerCase())
    if (!same) { const entry = { ...e }; out.push(entry); byKey.set(key, [...(byKey.get(key) || []), entry]); continue }
    // Keep the venue's own listing (or the fuller one) in front; the other becomes a second link.
    const swap = (own(e) && !own(same)) || (own(e) === own(same) && filled(e) > filled(same))
    const [main, other] = swap ? [{ ...e }, { ...same }] : [same, e]
    for (const f of ["price", "currency", "description", "venue", "city", "country", "end_date", "lon"]) if ((main[f] == null || main[f] === "") && other[f] != null) main[f] = other[f]
    main.also_listed_at = [...(same.also_listed_at || []), { domain: other.domain, url: other.url }].filter((x: any) => x.url !== main.url).slice(0, 3)
    if (swap) { Object.keys(same).forEach(k => delete same[k]); Object.assign(same, main) }
  }
  return out
}
