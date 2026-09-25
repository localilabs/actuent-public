import crypto from "crypto"

// Reference implementation of verifying a signed LAWP action request from Actuent.
// Signed string: "<X-Actuent-Timestamp>\n<METHOD>\n<full url>\n<sha256 hex of raw body>"
const JWKS_URL = "https://agents.actuent.ai/.well-known/actuent-signing-keys.json"
let jwksCache: { keys: any[], expires: number } | null = null

async function publicKey(kid: string): Promise<crypto.KeyObject | null> {
  if (!jwksCache || jwksCache.expires < Date.now() || !jwksCache.keys.some(k => k.kid === kid)) {
    const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(5000) })
    jwksCache = { keys: (await res.json()).keys || [], expires: Date.now() + 60 * 60 * 1000 }
  }
  const jwk = jwksCache.keys.find(k => k.kid === kid)
  return jwk ? crypto.createPublicKey({ key: jwk, format: "jwk" }) : null
}

export async function verifyActuentRequest(headers: Record<string, any>, method: string, url: string, rawBody: string): Promise<boolean> {
  try {
    const timestamp = String(headers["x-actuent-timestamp"] || "")
    const kid = String(headers["x-actuent-key-id"] || "")
    const signature = String(headers["x-actuent-signature"] || "").replace(/^v1=/, "")
    if (!timestamp || !kid || !signature) return false
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false // reject replays older than 5 min
    const key = await publicKey(kid)
    if (!key) return false
    const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex")
    const signed = `${timestamp}\n${method.toUpperCase()}\n${url}\n${bodyHash}`
    return crypto.verify(null, Buffer.from(signed), key, Buffer.from(signature, "base64url"))
  } catch { return false }
}
