// Plain-English notices for when Actuent can't give its best answer: busy times, unreachable
// sites, empty results. Every degraded or empty response carries one, so a person (or their AI
// assistant) always knows what happened and what to do — never just silence. The wording never
// talks about providers or internal limits: when it's crowded, it says so and asks to try again.
// The same wording is used by the MCP server (locali_private/src/utils/notices.ts) — keep in sync.
// Documented at docs.actuent.ai/#errors.

export type NoticeCode =
  | "busy_limited_results" | "busy_saved_copy" | "busy_no_results" | "busy"
  | "site_unreachable" | "robots_blocked" | "no_results" | "temporarily_unavailable"

export type Notice = { code: NoticeCode, message: string, retry_after_seconds?: number }

const SUPPORT = "If this keeps happening, email support@localilabs.com."
const BUSY = "Sorry — too many people are using Actuent right now."

export function notice(code: NoticeCode, v: { query?: string, domain?: string, updated?: string | null, retryAfter?: number } = {}): Notice {
  const retry = Math.min(Math.max(Math.ceil(v.retryAfter || 60), 30), 3600)
  const later = retry > 120 ? `in about ${Math.ceil(retry / 60)} minutes` : "in a minute or two"
  const messages: Record<NoticeCode, string> = {
    busy_limited_results: `${BUSY} These results are a quicker, simpler search and may be less complete than usual. Try again ${later} for the full search.`,
    busy_saved_copy: `${BUSY} This is Actuent's saved copy of ${v.domain || "the site"}${v.updated ? ` (last updated ${v.updated.slice(0, 10)})` : ""} rather than a fresh visit, so it may be slightly out of date. Try again ${later} for a fresh copy.`,
    busy_no_results: `${BUSY} Nothing in the Actuent index matched "${v.query || ""}", and we couldn't look further for you just now. Try again ${later}, or search for a website address like example.com.`,
    busy: `${BUSY} We couldn't finish this request. Please try again ${later}. ${SUPPORT}`,
    site_unreachable: `We couldn't reach ${v.domain || "that site"} just now — it may be down, slow or blocking automated visits. Try again later, or visit it directly.`,
    robots_blocked: `${v.domain || "This site"} asks automated visitors not to read it (robots.txt), and Actuent respects that.`,
    no_results: `Nothing in the Actuent index matched "${v.query || ""}". Try fewer or broader words, a brand name, or a website address like example.com.`,
    temporarily_unavailable: `Sorry — Actuent search is temporarily unavailable. Please try again ${later}. ${SUPPORT}`
  }
  const retryable = code !== "no_results" && code !== "robots_blocked" && code !== "site_unreachable"
  return { code, message: messages[code], ...(retryable ? { retry_after_seconds: retry } : {}) }
}

// Notices that mean "a retry soon would give a better answer": such responses aren't cached.
export const DEGRADED = new Set<NoticeCode>(["busy_limited_results", "busy_saved_copy", "busy_no_results", "busy", "temporarily_unavailable", "site_unreachable"])
