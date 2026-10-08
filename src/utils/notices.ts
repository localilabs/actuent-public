// Plain-English notices for when Actuent can't give its best answer: busy times, unreachable
// sites, empty results. Every degraded or empty response carries one, so a person (or their AI
// assistant) always knows what happened and what to do — never just silence. The wording never
// talks about providers or internal limits: when it's crowded, it says so and asks to try again.
// The same wording is used by the MCP server (locali_private/src/utils/notices.ts) — keep in sync.
// Documented at docs.actuent.ai/#errors.

export type NoticeCode =
  | "busy_limited_results" | "busy_saved_copy" | "busy_fallback_index" | "busy_queued" | "busy_no_results" | "busy" | "heavy_use"
  | "site_unreachable" | "robots_blocked" | "no_results" | "temporarily_unavailable"

export type Notice = { code: NoticeCode, message: string, retry_after_seconds?: number }

const SUPPORT = "If this keeps happening, email support@localilabs.com."
// In the voice of Lawpy, Actuent's mascot (a chaotic, cheeky explorer).
const BUSY = "Too many people are exploring with Lawpy right now! Give him a minute to catch his breath."

export function notice(code: NoticeCode, v: { query?: string, domain?: string, updated?: string | null, retryAfter?: number } = {}): Notice {
  const retry = Math.min(Math.max(Math.ceil(v.retryAfter || 60), 30), 3600)
  const later = retry > 120 ? `in about ${Math.ceil(retry / 60)} minutes` : "in a minute or two"
  const messages: Record<NoticeCode, string> = {
    busy_limited_results: `${BUSY} These results are a quicker, simpler search and may be less complete than usual. Try again ${later} for the full search.`,
    busy_saved_copy: `${BUSY} This is Actuent's saved copy of ${v.domain || "the site"}${v.updated ? ` (last updated ${v.updated.slice(0, 10)})` : ""} rather than a fresh visit, so it may be slightly out of date. A fresh visit is queued and will be done within the hour.`,
    busy_fallback_index: `${BUSY} These results come from Actuent's built-in copy of the index (the best-known sites and the next few days of events), so they're less complete than usual. Try again ${later} for the full search.`,
    busy_queued: `${BUSY} We couldn't visit ${v.domain || "that site"} live, so it's queued and will be added within the hour. Please try again later.`,
    heavy_use: `You've run a lot of free searches in the last hour, so these results come from a quicker, simpler search. Actuent Pro (actuent.ai) gives you the full search with priority, however much you use it.`,
    busy_no_results: `${BUSY} Nothing in the Actuent index matched "${v.query || ""}", and we couldn't look further for you just now. Try again ${later}, or search for a website address like example.com.`,
    busy: `${BUSY} We couldn't finish this request. Please try again ${later}. ${SUPPORT}`,
    site_unreachable: `We couldn't reach ${v.domain || "that site"} just now — it may be down, slow or blocking automated visits. Try again later, or visit it directly.`,
    robots_blocked: `${v.domain || "This site"} asks automated visitors not to read it (robots.txt), and Actuent respects that.`,
    no_results: `Lawpy ran all over the index and came back empty-handed for "${v.query || ""}". Rude of it, honestly. Try fewer or broader words, a brand name, or a website address like example.com.`,
    temporarily_unavailable: `Lawpy has tripped over a cable: Actuent search is unavailable for a moment. Please try again ${later}. ${SUPPORT}`
  }
  const retryable = !["no_results", "robots_blocked", "site_unreachable", "heavy_use"].includes(code)
  return { code, message: messages[code], ...(retryable ? { retry_after_seconds: retry } : {}) }
}

// Notices that mean "a retry soon would give a better answer": such responses aren't cached.
export const DEGRADED = new Set<NoticeCode>(["busy_limited_results", "busy_saved_copy", "busy_fallback_index", "busy_queued", "busy_no_results", "heavy_use", "busy", "temporarily_unavailable", "site_unreachable"])
