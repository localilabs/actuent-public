-- Groq quota round (2026-09-25). Run once in Supabase → SQL Editor.
-- Stores a hash of each site's scraped content so unchanged sites reuse their LAWP instead of
-- spending LLM tokens on every re-crawl. Until this runs, the code works as before.
alter table lawp_sites add column if not exists content_hash text;
