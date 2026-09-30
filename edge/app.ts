// The read-only part of actuent-public on Supabase Edge Functions (Deno): site, city and directory
// pages, sitemaps, badges, trends, change feeds and small lookups. They need nothing but the
// database, and Supabase gives the function its own database key, so all API keys stay on Vercel.
// Vercel still serves the domains and the CDN cache and passes these paths straight through
// (vercel.json), so no Vercel Function runs for them; Supabase bills per request, not for waiting.
// Search, sign-up, ask, click links, unsubscribe and IndexNow stay on Vercel (they use keys).
// The handlers are the same code as on Vercel (edge/adapter.ts gives them req/res). Routing uses
// edge/routes.json: the same public paths as before. Built by scripts/build-edge.mjs.

import data from "../api/data"
import wellKnown from "../api/well-known"
import badge from "../api/badge"
import sitemap from "../api/sitemap"
import site from "../api/site"
import ROUTES from "./routes.json"
import { serve } from "./adapter"

export const handle = serve("api", "api.actuent.ai", ROUTES, {
  "/api/data.ts": data, "/api/well-known.ts": wellKnown,
  "/api/badge.ts": badge, "/api/sitemap.ts": sitemap, "/api/site.ts": site
})
