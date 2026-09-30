// Supabase Edge Function entry (see edge/app.ts).
import { handle } from "./app"
declare const Deno: any
Deno.serve(handle)
