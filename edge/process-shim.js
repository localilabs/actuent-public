// `process` for the bundled code on Supabase Edge Functions: the real node:process, but with its own
// copy of the environment. Supabase doesn't allow changing environment variables, and the code
// needs two extra ones: SUPABASE_SERVICE_KEY (sent as ACTUENT_SERVICE_KEY, since SUPABASE_* secret
// names are reserved) and the commit (for the search cache key). esbuild's `inject` points every
// `process` in the bundle here (scripts/build-edge.mjs).
import real from "node:process"
// Read on demand (Supabase's environment can't be listed or copied in one go), with two additions.
const extra = () => ({
  SUPABASE_SERVICE_KEY: real.env.SUPABASE_SERVICE_KEY || real.env.ACTUENT_SERVICE_KEY || real.env.SUPABASE_SERVICE_ROLE_KEY,
  VERCEL_GIT_COMMIT_SHA: real.env.VERCEL_GIT_COMMIT_SHA || globalThis.__ACTUENT_COMMIT__ || ""
})
const env = new Proxy({}, {
  get: (_, key) => typeof key === "string" ? (extra()[key] ?? real.env[key]) : undefined,
  has: (_, key) => typeof key === "string" && (extra()[key] != null || real.env[key] != null),
  set: () => true
})
export const process = new Proxy(real, { get: (target, key) => key === "env" ? env : Reflect.get(target, key) })
