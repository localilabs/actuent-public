// Runs Vercel-style handlers (req, res) on Supabase Edge Functions (Deno): builds a VercelRequest-
// like object from a fetch Request and turns the VercelResponse calls into a Response. Same file in
// locali_public and locali_private (edge/adapter.ts). Routes: [{ src: regex, dest: "/api/x.ts?op=y" }]
// in the order vercel.json used to list them.

type Handler = (req: any, res: any) => unknown
export type Route = { src: string, dest: string }

function parseBody(type: string, text: string): unknown {
  if (!text) return undefined
  if (type.includes("application/json")) { try { return JSON.parse(text) } catch { return text } }
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(text))
  return text
}

// The response side of VercelResponse: status, setHeader, json, send, end, redirect.
class EdgeResponse {
  statusCode = 200
  headers = new Headers()
  body: BodyInit | null = null
  headersSent = false
  private done!: () => void
  finished = new Promise<void>(r => { this.done = r })
  status(code: number) { this.statusCode = code; return this }
  setHeader(name: string, value: string | number | string[]) {
    if (Array.isArray(value)) { this.headers.delete(name); for (const v of value) this.headers.append(name, v) }
    else this.headers.set(name, String(value))
    return this
  }
  getHeader(name: string) { return this.headers.get(name) ?? undefined }
  removeHeader(name: string) { this.headers.delete(name) }
  json(obj: unknown) {
    if (!this.headers.has("content-type")) this.headers.set("content-type", "application/json; charset=utf-8")
    return this.send(JSON.stringify(obj))
  }
  send(body: unknown) {
    if (this.headersSent) return this
    if (body == null) this.body = null
    else if (typeof body === "string" || body instanceof Uint8Array || body instanceof ArrayBuffer) this.body = body as BodyInit
    else if (typeof body === "object") return this.json(body)
    else this.body = String(body)
    if (typeof body === "string" && !this.headers.has("content-type")) this.headers.set("content-type", "text/html; charset=utf-8")
    this.headersSent = true
    this.done()
    return this
  }
  end(body?: unknown) { return this.send(body ?? null) }
  redirect(a: number | string, b?: string) {
    const [code, url] = typeof a === "number" ? [a, b!] : [302, a]
    this.statusCode = code
    this.headers.set("location", url)
    return this.end()
  }
  toResponse() {
    const noBody = this.statusCode === 204 || this.statusCode === 304
    return new Response(noBody ? null : this.body, { status: this.statusCode, headers: this.headers })
  }
}

// The function's own name comes first in the path (/api/… or /functions/v1/api/…).
function publicPath(url: URL, fn: string): string {
  return url.pathname.replace(/^\/functions\/v1/, "").replace(new RegExp(`^\\/${fn}(?=\\/|$)`), "") || "/"
}

export function serve(fn: string, host: string, routes: Route[], handlers: Record<string, Handler>) {
  const compiled = routes.map(r => ({ re: new RegExp(`^${r.src}$`), dest: r.dest }))
  const route = (path: string) => {
    for (const r of compiled) {
      const m = path.match(r.re)
      if (!m) continue
      const dest = r.dest.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? "")
      const [file, qs] = dest.split("?")
      const handler = handlers[file]
      return handler ? { handler, query: Object.fromEntries(new URLSearchParams(qs || "")) } : null
    }
    return null
  }
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = publicPath(url, fn)
    const match = route(path)
    if (!match) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "content-type": "application/json" } })
    const headers: Record<string, string> = {}
    request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
    // Behind the Vercel proxy the request arrives for Supabase's host: handlers see the public one.
    headers.host = headers["x-forwarded-host"] && !/supabase\./.test(headers["x-forwarded-host"]) ? headers["x-forwarded-host"] : host
    const query: Record<string, string | string[]> = {}
    for (const k of new Set(url.searchParams.keys())) { const all = url.searchParams.getAll(k); query[k] = all.length > 1 ? all : all[0] }
    // The route's own parameters (e.g. op=stats) are kept, as on Vercel.
    Object.assign(query, match.query)
    const hasBody = !["GET", "HEAD", "OPTIONS"].includes(request.method)
    const raw = hasBody ? new Uint8Array(await request.arrayBuffer()) : new Uint8Array()
    const text = new TextDecoder().decode(raw)
    const req: any = {
      method: request.method, url: path + url.search, headers, query, cookies: {},
      body: hasBody ? parseBody(headers["content-type"] || "", text) : undefined,
      // Webhooks that check a signature read the raw body: for await (const chunk of req).
      async *[Symbol.asyncIterator]() { if (raw.length) yield (globalThis as any).Buffer ? (globalThis as any).Buffer.from(raw) : raw }
    }
    const res = new EdgeResponse()
    try {
      await Promise.race([Promise.resolve(match.handler(req, res)), res.finished])
      if (!res.headersSent) await Promise.race([res.finished, new Promise(r => setTimeout(r, 25000))])
    } catch (e) {
      console.error("handler failed:", e)
      if (!res.headersSent) { res.status(500).setHeader("cache-control", "no-store"); res.json({ error: "Something went wrong. Please try again." }) }
    }
    if (!res.headersSent) { res.status(504); res.json({ error: "Timed out" }) }
    return res.toResponse()
  }
}
