// robots.txt support (RFC 9309). Actuent obeys rules for the "Actuent" user agent, or "*" if a
// site has none, and identifies itself with a link to https://docs.actuent.ai/bot.

export const USER_AGENT = "Mozilla/5.0 (compatible; Actuent/1.0; +https://docs.actuent.ai/bot)"
const AGENT_TOKEN = "actuent"

type Rule = { allow: boolean, pattern: string }
const cache = new Map<string, { rules: Rule[] | "disallow-all", expires: number }>()

function parse(text: string): Rule[] {
  const groups: { agents: string[], rules: Rule[] }[] = []
  let current: { agents: string[], rules: Rule[] } | null = null
  let lastWasAgent = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim()
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!m) continue
    const key = m[1].toLowerCase(), value = m[2].trim()
    if (key === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current) }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
    } else if ((key === "allow" || key === "disallow") && current) {
      if (value) current.rules.push({ allow: key === "allow", pattern: value })
      lastWasAgent = false
    } else {
      lastWasAgent = false
    }
  }
  const ours = groups.filter(g => g.agents.some(a => a.replace(/\/.*$/, "") === AGENT_TOKEN || a.includes(AGENT_TOKEN)))
  const chosen = ours.length ? ours : groups.filter(g => g.agents.includes("*"))
  return chosen.flatMap(g => g.rules)
}

function matches(pattern: string, path: string): number {
  const anchored = pattern.endsWith("$")
  const body = anchored ? pattern.slice(0, -1) : pattern
  const regex = new RegExp("^" + body.split("*").map(p => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""))
  return regex.test(path) ? body.length : -1
}

async function rulesFor(host: string): Promise<Rule[] | "disallow-all"> {
  const cached = cache.get(host)
  if (cached && cached.expires > Date.now()) return cached.rules
  let rules: Rule[] | "disallow-all" = []
  try {
    const res = await fetch(`https://${host}/robots.txt`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(4000) })
    if (res.ok) rules = parse((await res.text()).slice(0, 500_000))
    else if (res.status >= 500) rules = "disallow-all" // RFC 9309: unreachable robots.txt means don't crawl
  } catch {
    rules = [] // network failure: the page fetch will fail too if the site is down
  }
  cache.set(host, { rules, expires: Date.now() + 60 * 60 * 1000 })
  return rules
}

// True when robots.txt lets Actuent fetch this path. The longest matching rule wins; Allow wins ties.
export async function robotsAllows(host: string, path: string = "/"): Promise<boolean> {
  const rules = await rulesFor(host)
  if (rules === "disallow-all") return false
  let best: { length: number, allow: boolean } = { length: -1, allow: true }
  for (const rule of rules) {
    const length = matches(rule.pattern, path)
    if (length > best.length || (length === best.length && rule.allow)) best = { length, allow: rule.allow }
  }
  return best.allow
}
