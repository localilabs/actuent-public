// Runs bookkeeping (search log, counters, crawl queue) after the response has been sent, so busy
// database moments don't make people wait. Uses Vercel's waitUntil when the runtime provides it
// (the same hook @vercel/functions uses); anywhere else it simply waits, as before.
export function later(work: Promise<unknown>): Promise<void> {
  const ctx = (globalThis as any)[Symbol.for("@vercel/request-context")]?.get?.()
  const safe = work.then(() => {}, () => {})
  if (typeof ctx?.waitUntil === "function") { ctx.waitUntil(safe); return Promise.resolve() }
  return safe
}
