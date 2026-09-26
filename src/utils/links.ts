import crypto from "crypto"

// Links Actuent gives to AI agents go through api.actuent.ai/go, which counts the visit for the
// site's owner (domain and day only — nothing about the person) and redirects. Links are signed so
// /go can't be used as an open redirect.

const SECRET = process.env.SUPABASE_SERVICE_KEY || ""

export function linkSignature(url: string): string {
  return crypto.createHmac("sha256", SECRET).update(`go:${url}`).digest("hex").slice(0, 16)
}

export function trackedLink(url: string): string {
  if (!SECRET || !/^https?:\/\//.test(url)) return url
  return `https://api.actuent.ai/go?u=${encodeURIComponent(url)}&s=${linkSignature(url)}`
}
