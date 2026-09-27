import crypto from "crypto"

// Links Actuent gives to AI agents go through api.actuent.ai/go, which counts the visit for the
// site's owner (domain and day only — nothing about the person) and redirects. Links are signed so
// /go can't be used as an open redirect.

const SECRET = process.env.SUPABASE_SERVICE_KEY || ""

export function linkSignature(url: string): string {
  return crypto.createHmac("sha256", SECRET).update(`go:${url}`).digest("hex").slice(0, 16)
}

// The search words can ride along (signed, so they can't be faked) to learn which results people
// actually open for a search (query_clicks, list_eleven.sql). Only the words and the site are kept.
export function querySignature(url: string, query: string): string {
  return crypto.createHmac("sha256", SECRET).update(`goq:${url}|${query}`).digest("hex").slice(0, 16)
}

export function trackedLink(url: string, query?: string): string {
  if (!SECRET || !/^https?:\/\//.test(url)) return url
  const q = query ? query.toLowerCase().trim().slice(0, 100) : ""
  return `https://api.actuent.ai/go?u=${encodeURIComponent(url)}&s=${linkSignature(url)}${q ? `&q=${encodeURIComponent(q)}&qs=${querySignature(url, q)}` : ""}`
}
