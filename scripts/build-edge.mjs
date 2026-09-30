// Builds edge/app.ts (and everything it imports) into one file for Supabase Edge Functions:
// supabase/functions/api/index.js. Node built-ins become node: imports, which Deno understands.
//   node scripts/build-edge.mjs && supabase functions deploy api --no-verify-jwt --project-ref bcmwypjrahtxogytsvuc
import { build } from "esbuild"
import { builtinModules } from "module"
import { execSync } from "child_process"

// The commit goes into the search cache key (as VERCEL_GIT_COMMIT_SHA did on Vercel), so a new
// deploy never serves answers cached by the old code.
const sha = execSync("git rev-parse --short HEAD").toString().trim()

const nodeBuiltins = {
  name: "node-builtins",
  setup(b) {
    const names = new RegExp(`^(${builtinModules.map(m => m.replace(/[/]/g, "\\/")).join("|")})$`)
    b.onResolve({ filter: names }, args => ({ path: `node:${args.path}`, external: true }))
    b.onResolve({ filter: /^node:/ }, args => ({ path: args.path, external: true }))
  }
}

await build({
  entryPoints: ["edge/main.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  mainFields: ["module", "main"],
  conditions: ["import", "node", "default"],
  target: "es2022",
  outfile: "supabase/functions/api/index.js",
  plugins: [nodeBuiltins],
  // @vercel/og stays on Vercel (/og): it isn't bundled.
  external: ["@vercel/og"],
  loader: { ".json": "json" },
  inject: ["edge/process-shim.js"],
  banner: { js: `import { Buffer as __Buffer } from "node:buffer"; globalThis.Buffer ??= __Buffer; globalThis.__ACTUENT_COMMIT__ = "${sha}";` },
  logLevel: "warning"
})
console.log("built supabase/functions/api/index.js")
