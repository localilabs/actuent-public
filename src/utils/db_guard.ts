// When the database goes read-only (Supabase does this when the disk is full) every write fails, and each
// failed log line, counter or cache write still costs a round trip before the answer goes out. This
// watches Supabase's answers: after a "read-only" or "disk full" error, writes are skipped for two
// minutes (answered at once with a 503 the callers already treat as "didn't work"), while reads and
// searches carry on as normal. Installed once per server, by importing this file.

const BASE = process.env.SUPABASE_URL || ""
const WRITE_RPC = /^(hit_|add_|queue_|increment|bump|log_|record_|upsert)/
const READ_ONLY = /25006|53100|read-only transaction|could not extend file|no space left|disk.*full/i
let skipUntil = 0

export const dbReadOnly = () => Date.now() < skipUntil
export function markDbReadOnly(ms = 120_000) { skipUntil = Date.now() + ms }

function isWrite(url: string, method: string): boolean {
  const path = url.slice(BASE.length)
  if (!path.startsWith("/rest/v1/")) return false
  const rpc = path.match(/^\/rest\/v1\/rpc\/([a-z_]+)/)
  if (rpc) return WRITE_RPC.test(rpc[1])
  return method !== "GET" && method !== "HEAD"
}

const g = globalThis as any
if (BASE && !g.__actuentDbGuard) {
  g.__actuentDbGuard = true
  const real: typeof fetch = g.fetch.bind(globalThis)
  g.fetch = async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || ""
    if (!url.startsWith(BASE)) return real(input, init)
    const method = String(init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase()
    const write = isWrite(url, method)
    if (write && dbReadOnly()) {
      return new Response(JSON.stringify({ code: "25006", message: "skipped: the database is read-only right now" }), { status: 503, headers: { "Content-Type": "application/json" } })
    }
    const res = await real(input, init)
    if (write && res.status >= 400) {
      const text = await res.clone().text().catch(() => "")
      if (READ_ONLY.test(text)) { markDbReadOnly(); console.warn("Database is read-only: skipping writes for 2 minutes") }
    }
    return res
  }
}
