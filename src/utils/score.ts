// Agent-readiness score (0–100): how well AI agents can understand and act on a site.
// Used by the live badge, the public site pages and the weekly score emails.
// Copied to actuent-crawler/score.ts — keep in sync.

// How to fix each failed readiness check. The starter files mentioned are on the site's page
// (api.actuent.ai/site/<domain>).
export const FIXES: Record<string, string> = {
  "Clear description of the site": "Add a meta description and a plain first paragraph that says what you do, where, and for whom.",
  "Several pages described": "List your key pages (services, prices, about, contact) in the <code>pages</code> of your starter lawp.json, or link them from your homepage and sitemap.",
  "Actions agents can take": "Add the things customers do on your site (book, order, contact, get a quote) as <code>actions</code> in lawp.json.",
  "3 or more actions": "Most businesses have at least three: contact, book or order, and view prices.",
  "Publishes its own LAWP (/.well-known/lawp.json)": "Publish your starter lawp.json at <code>/.well-known/lawp.json</code>. WordPress: install the <a href=\"https://github.com/localilabs/actuent-wordpress/releases/latest\">Actuent plugin</a>. Cloudflare: use the <a href=\"https://github.com/localilabs/actuent-cloudflare\">one-click Worker</a>.",
  "Actions agents can execute": "Give an action an <code>endpoint</code> on your domain so agents can do it for the user, not just link to it. See <a href=\"https://docs.actuent.ai/#actions\">LAWP Actions</a>.",
  "Business details (address, hours, phone)": "Add schema.org business data to your homepage (the starter snippet). Google uses it too."
}

export type ScoreBreakdown = { score: number, label: string, checks: { label: string, ok: boolean, points: number, fix: string }[] }

export function readiness(site: any): ScoreBreakdown {
  const pages = Object.values(site?.pages || {}) as any[]
  const actions = (site?.actions || []) as any[]
  const executable = !!site?.native && actions.some(a => typeof a?.endpoint?.url === "string")
  const home = pages[0]?.content || ""
  const checks = [
    { label: "Clear description of the site", ok: home.length > 80 && !/^Website at /.test(home), points: 15 },
    { label: "Several pages described", ok: pages.length >= 3, points: 15 },
    { label: "Actions agents can take", ok: actions.length >= 1, points: 15 },
    { label: "3 or more actions", ok: actions.length >= 3, points: 10 },
    { label: "Publishes its own LAWP (/.well-known/lawp.json)", ok: !!site?.native, points: 15 },
    { label: "Actions agents can execute", ok: executable, points: 15 },
    { label: "Business details (address, hours, phone)", ok: !!site?.business, points: 15 }
  ]
  const withFixes = checks.map(c => ({ ...c, fix: FIXES[c.label] || "" }))
  const score = checks.reduce((sum, c) => sum + (c.ok ? c.points : 0), 0)
  return { score, label: score >= 80 ? "Agent-ready" : score >= 45 ? "Partly agent-ready" : "Not agent-ready yet", checks: withFixes }
}
