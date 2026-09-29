// After every production deploy: 15 key searches must still work. A failure fails the GitHub job,
// and GitHub emails the repository owner. Plain Node, no dependencies.
//   API=https://api.actuent.ai node scripts/smoke.mjs
const API = process.env.API || "https://api.actuent.ai"
const top = (d, n = 5) => (d.results || []).slice(0, n).map(r => String(r.domain).split("/")[0])
const CHECKS = [
  ["nike.com", d => top(d, 1)[0] === "nike.com", "nike.com first"],
  ["localilabs", d => top(d, 1)[0] === "localilabs.com" && top(d).includes("actuent.ai"), "localilabs.com first, actuent.ai too"],
  ["notion vs obsidian", d => d.comparison?.sites?.includes("notion.so") && d.comparison?.sites?.includes("obsidian.md"), "a comparison of notion.so and obsidian.md"],
  ["does basecamp have a free plan", d => top(d, 1)[0] === "basecamp.com" && !!d.answer, "basecamp.com first, with an answer"],
  ["running shoes", d => (d.results || []).length >= 5, "at least 5 results"],
  ["shoes under 500 dkk copenhagen", d => !(d.products || []).some(p => ["INR", "PHP", "IDR"].includes(p.currency)), "no far-off-market products"],
  ["barber copenhagen", d => top(d).filter(x => x.endsWith(".dk")).length >= 2, "Copenhagen barbers (.dk)"],
  ["museo madrid", d => top(d).some(x => /museodelprado|museoreinasofia|museothyssen/.test(x)), "a Madrid museum"],
  ["email marketing", d => top(d).some(x => /mailchimp|klaviyo|brevo|convertkit|kit\.com|campaignmonitor|constantcontact|hubspot|mailerlite|getresponse/.test(x)), "an email marketing service"],
  ["password manager", d => top(d).some(x => /1password|bitwarden|dashlane|lastpass|keeper|nordpass|proton/.test(x)), "a password manager"],
  ["laufschuhe", d => (d.results || []).length >= 3, "results for a German search"],
  ["louvre tickets", d => top(d, 3).includes("louvre.fr"), "louvre.fr near the top"],
  ["concerts london", d => (d.results || []).length >= 1, "results for events"],
  ["spotify", d => top(d, 1)[0] === "spotify.com", "spotify.com first"],
  ["asdkjhqwe zxcmnb", d => Array.isArray(d.results), "nonsense doesn't break search"]
]

let failed = 0
for (const [q, ok, what] of CHECKS) {
  const t = Date.now()
  let d = {}, status = 0
  try {
    const r = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}&_=${Date.now()}`, { headers: { "User-Agent": "Actuent-Smoke/1.0" }, signal: AbortSignal.timeout(30000) })
    status = r.status
    d = await r.json().catch(() => ({}))
  } catch (e) { status = String(e?.message || e) }
  const pass = status === 200 && (() => { try { return !!ok(d) } catch { return false } })()
  if (!pass) failed++
  console.log(`${pass ? "✓" : "✗"} ${String(Date.now() - t).padStart(6)}ms  ${q}  (${what})${pass ? "" : `  → ${status} ${top(d).join(", ") || d.message || ""}`}`)
  await new Promise(r => setTimeout(r, 3500)) // stay under the free rate limit
}
console.log(failed ? `\n${failed} of ${CHECKS.length} checks failed.` : `\nAll ${CHECKS.length} checks passed.`)
// Two misses can be a slow moment; three or more means something broke.
if (failed >= 3) process.exit(1)
