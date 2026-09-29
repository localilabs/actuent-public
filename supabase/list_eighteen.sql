-- List eighteen (2026-09-29). Run once in Supabase → SQL Editor. Safe to run again. Takes seconds.

-- 1. Saved-search alerts (Pro): "tell me when a new vegan café in Copenhagen appears". A daily job
-- (actuent-crawler saved_searches.ts) re-runs each search and emails the owner (and POSTs to their
-- webhook) when a site that's new to Actuent shows up. `seen` holds the domains already reported.
create table if not exists saved_searches (
  id bigserial primary key,
  api_key text not null,            -- the owner's hashed API key
  query text not null,
  webhook_url text,
  seen jsonb not null default '[]',
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  alerted_at timestamptz,
  unique (api_key, query)
);
alter table saved_searches enable row level security;

-- 2. Change feeds (api.actuent.ai/changes.rss and /site/<domain>/changes.rss): newest changes first.
create index if not exists lawp_diffs_detected_idx on lawp_diffs (detected_at desc);
create index if not exists lawp_diffs_domain_detected_idx on lawp_diffs (domain, detected_at desc);

-- 3. Search trends (api.actuent.ai/trends): what people searched most, counted in the database so
-- the page never downloads the search log. Only plain searches made at least `min_count` times;
-- never emails, links, long numbers or long text, and never our own test searches (tier "test").
create index if not exists searches_created_idx on searches (created_at);
create or replace function search_trends(since timestamptz, min_count int default 3, max_rows int default 300)
returns table (query text, searches bigint, days bigint)
language sql stable as $$
  select lower(btrim(s.query)) as query, count(*) as searches, count(distinct date_trunc('day', s.created_at)) as days
  from searches s
  where s.created_at >= since
    and coalesce(s.tier, 'free') in ('free', 'pro')
    and length(btrim(s.query)) between 2 and 40
    and s.query !~ '[@/:]'
    and s.query !~ '[0-9]{4,}'
  group by 1
  having count(*) >= min_count
  order by 2 desc
  limit max_rows
$$;
revoke execute on function search_trends(timestamptz, int, int) from public, anon, authenticated;
