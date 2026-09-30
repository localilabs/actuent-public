// Runs bookkeeping (search log, counters, crawl queue) after the response has been sent, so busy
// database moments don't make people wait. Uses the platform's waitUntil: Supabase Edge Functions
// (EdgeRuntime.waitUntil) or Vercel (the same hook @vercel/functions uses); anywhere else it simply waits.
export function later(work: Promise<unknown>): Promise<void> {
  const safe = work.then(() => {}, () => {})
  const edge = (globalThis as any).EdgeRuntime
  if (typeof edge?.waitUntil === "function") { edge.waitUntil(safe); return Promise.resolve() }
  const ctx = (globalThis as any)[Symbol.for("@vercel/request-context")]?.get?.()
  if (typeof ctx?.waitUntil === "function") { ctx.waitUntil(safe); return Promise.resolve() }
  return safe
}
