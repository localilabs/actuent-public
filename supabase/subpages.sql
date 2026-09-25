-- Subpages round (2026-09-25). Run once in Supabase → SQL Editor.
-- Marks sites whose /pricing, /about and /contact pages have been checked by the daily
-- "Index Subpages" job (actuent-crawler/subpages.ts), so each site is done once.
alter table lawp_sites add column if not exists subpages_crawled_at timestamptz;
