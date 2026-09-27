-- List eight (2026-09-27). Run once in Supabase → SQL Editor, after list_seven.sql. Safe to run again.

-- 8. Security: account connect links work once.
create table if not exists used_tokens (
  nonce text primary key,
  used_at timestamptz not null default now()
);
alter table used_tokens enable row level security;

-- 7. Cheap freshness checks (actuent-crawler/freshness.ts): the refresh job remembers each
-- homepage's ETag / Last-Modified and a hash of its visible text, and when it last checked it
-- (refreshed_at; checked_at already belongs to the parked/duplicate cleanup).
-- An unchanged site costs one conditional GET instead of Jina Reader plus an LLM call.
alter table lawp_sites add column if not exists http_etag text;
alter table lawp_sites add column if not exists http_last_modified text;
alter table lawp_sites add column if not exists page_fingerprint text;
alter table lawp_sites add column if not exists refreshed_at timestamptz;

-- 9. Speed: the directory's "recently updated" list (api/site.ts) reads this order.
create index if not exists lawp_sites_recent_idx on lawp_sites (native desc, updated_at desc) where status is null;
