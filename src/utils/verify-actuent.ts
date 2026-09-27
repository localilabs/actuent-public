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

// ----- LAWP 0.4: HTTP Message Signatures (RFC 9421), as used by Web Bot Auth -----
// Reference verifier. Trusts only the agents listed below; keys come from each agent's
// /.well-known/http-message-signatures-directory, matched by JWK thumbprint (RFC 7638).
const TRUSTED_AGENTS = ["https://agents.actuent.ai"]
const directoryCache = new Map<string, { keys: any[], expires: number }>()

function thumbprint(jwk: any): string {
  return crypto.createHash("sha256").update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x })).digest("base64url")
}

async function directoryKey(agent: string, keyid: string): Promise<crypto.KeyObject | null> {
  let entry = directoryCache.get(agent)
  if (!entry || entry.expires < Date.now() || !entry.keys.some(k => thumbprint(k) === keyid)) {
    const res = await fetch(`${agent}/.well-known/http-message-signatures-directory`, { signal: AbortSignal.timeout(5000) })
    entry = { keys: res.ok ? (await res.json()).keys || [] : [], expires: Date.now() + 60 * 60 * 1000 }
    directoryCache.set(agent, entry)
  }
  const jwk = entry.keys.find(k => k.kty === "OKP" && k.crv === "Ed25519" && thumbprint(k) === keyid)
  return jwk ? crypto.createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, format: "jwk" }) : null
}

export async function verifyHttpSignature(headers: Record<string, any>, method: string, url: string, rawBody: string): Promise<boolean> {
  try {
    const input = String(headers["signature-input"] || "")
    const sig = String(headers["signature"] || "").match(/sig1=:([^:]+):/)?.[1]
    const m = input.match(/^sig1=(\(([^)]*)\)(.*))$/)
    if (!sig || !m) return false
    const params = m[1], components = [...m[2].matchAll(/"([^"]+)"/g)].map(x => x[1])
    const param = (name: string) => m[3].match(new RegExp(`;${name}=("?)([^;"]*)\\1`))?.[2]
    const created = Number(param("created")), expires = Number(param("expires")), now = Date.now() / 1000
    if (param("alg") !== "ed25519" || param("tag") !== "lawp" || !created || now - created > 300 || (expires && now > expires)) return false
    // Every part of the request that matters must be covered.
    const needed = ["@method", "@target-uri", "signature-agent", ...(rawBody ? ["content-digest"] : [])]
    if (!needed.every(c => components.includes(c))) return false
    const agent = String(headers["signature-agent"] || "").replace(/^"|"$/g, "")
    if (!TRUSTED_AGENTS.includes(agent)) return false
    if (rawBody) {
      const digest = `sha-256=:${crypto.createHash("sha256").update(rawBody).digest("base64")}:`
      if (String(headers["content-digest"] || "") !== digest) return false
    }
    const value = (c: string) => c === "@method" ? method.toUpperCase() : c === "@target-uri" ? url : String(headers[c] ?? "")
    const base = [...components.map(c => `"${c}": ${value(c)}`), `"@signature-params": ${params}`].join("\n")
    const key = await directoryKey(agent, String(param("keyid") || ""))
    return !!key && crypto.verify(null, Buffer.from(base), key, Buffer.from(sig, "base64"))
  } catch { return false }
}

// Either scheme: RFC 9421 (LAWP 0.4) or Actuent's original headers (LAWP 0.2).
export async function verifyAgentRequest(headers: Record<string, any>, method: string, url: string, rawBody: string): Promise<"rfc9421" | "actuent-v1" | null> {
  if (headers["signature-input"] && await verifyHttpSignature(headers, method, url, rawBody)) return "rfc9421"
  if (await verifyActuentRequest(headers, method, url, rawBody)) return "actuent-v1"
  return null
}
