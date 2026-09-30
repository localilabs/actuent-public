// actuent-public on Supabase Edge Functions (Deno). Vercel still serves the domains, the static
// files and the CDN cache, but passes every API and page request straight through to this one
// function (vercel.json), so no Vercel Function runs for them. Supabase bills edge functions per
// request, not for the time spent waiting on the database.
// The handlers are the same code as on Vercel (edge/adapter.ts gives them req/res). Routing uses
// edge/routes.json: the same public paths as before. Built by scripts/build-edge.mjs.

import search from "../api/search"
import data from "../api/data"
import register from "../api/register"
import wellKnown from "../api/well-known"
import badge from "../api/badge"
import sitemap from "../api/sitemap"
import suggest from "../api/suggest"
import site from "../api/site"
import ROUTES from "./routes.json"
import { serve } from "./adapter"

export const handle = serve("api", "api.actuent.ai", ROUTES, {
  "/api/search.ts": search, "/api/data.ts": data, "/api/register.ts": register, "/api/well-known.ts": wellKnown,
  "/api/badge.ts": badge, "/api/sitemap.ts": sitemap, "/api/suggest.ts": suggest, "/api/site.ts": site
})
