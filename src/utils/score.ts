// Agent-readiness score (0–100): how well AI agents can understand and act on a site.
// Used by the live badge and the public site pages.

export type ScoreBreakdown = { score: number, label: string, checks: { label: string, ok: boolean, points: number }[] }

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
  const score = checks.reduce((sum, c) => sum + (c.ok ? c.points : 0), 0)
  return { score, label: score >= 80 ? "Agent-ready" : score >= 45 ? "Partly agent-ready" : "Not agent-ready yet", checks }
}
