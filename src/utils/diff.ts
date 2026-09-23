const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

export function diffLAWP(previous: any, current: any): any {
  const changes: any = {}
  if (previous.name !== current.name) changes.name = { from: previous.name, to: current.name }
  const prevPages = previous.pages || {}
  const currPages = current.pages || {}
  const pageChanges: any = {}
  const allPaths = new Set([...Object.keys(prevPages), ...Object.keys(currPages)])
  for (const path of allPaths) {
    if (!prevPages[path]) pageChanges[path] = { status: "added", content: currPages[path] }
    else if (!currPages[path]) pageChanges[path] = { status: "removed" }
    else if (prevPages[path].title !== currPages[path].title || prevPages[path].content !== currPages[path].content) {
      pageChanges[path] = {
        status: "changed",
        title: prevPages[path].title !== currPages[path].title ? { from: prevPages[path].title, to: currPages[path].title } : undefined,
        content: prevPages[path].content !== currPages[path].content ? { from: prevPages[path].content, to: currPages[path].content } : undefined
      }
    }
  }
  if (Object.keys(pageChanges).length > 0) changes.pages = pageChanges
  const prevActions = (previous.actions || []).map((a: any) => a.id)
  const currActions = (current.actions || []).map((a: any) => a.id)
  const addedActions = currActions.filter((id: string) => !prevActions.includes(id))
  const removedActions = prevActions.filter((id: string) => !currActions.includes(id))
  if (addedActions.length > 0 || removedActions.length > 0) {
    changes.actions = {}
    if (addedActions.length > 0) changes.actions.added = addedActions
    if (removedActions.length > 0) changes.actions.removed = removedActions
  }
  return changes
}

export async function saveDiff(domain: string, previous: any, current: any, changes: any): Promise<void> {
  try {
    const description = await describeChanges(domain, changes)
    await fetch(`${SUPABASE_URL}/rest/v1/lawp_diffs`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ domain, previous, current, changes, description })
    })
    await fireWebhooks(domain, changes)
  } catch {}
}

async function describeChanges(domain: string, changes: any): Promise<string> {
  try {
    const Groq = (await import("groq-sdk")).default
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [{
        role: "user",
        content: `A website's LAWP (AI-readable format) changed. Write one plain English sentence describing what changed. Be specific.\n\nDomain: ${domain}\nChanges: ${JSON.stringify(changes)}`
      }],
      temperature: 0.1
    })
    return completion.choices?.[0]?.message?.content?.trim() || ""
  } catch { return "" }
}

async function fireWebhooks(domain: string, changes: any): Promise<void> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/webhooks?domain=eq.${domain}&select=url`,
      { headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` } }
    )
    const webhooks = await res.json()
    for (const wh of (webhooks || [])) {
      try {
        await fetch(wh.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "lawp.changed", domain, changes, timestamp: new Date().toISOString() }),
          signal: AbortSignal.timeout(5000)
        })
      } catch {}
    }
  } catch {}
}

export async function getLatestDiff(domain: string): Promise<any | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lawp_diffs?domain=eq.${domain}&order=detected_at.desc&limit=1`,
      { headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` } }
    )
    const data = await res.json()
    return data?.[0] || null
  } catch { return null }
}