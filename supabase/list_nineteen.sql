-- List nineteen (2026-09-30). Run once in Supabase → SQL Editor. Safe to run again. Takes seconds.
-- Adds almost nothing to the database's size.

-- 3. Sizes and colours of products (Shopify variant options that are in stock), so "nike shoes
-- size 44" finds shoes you can actually buy in 44. Filled in by the daily products job.
alter table lawp_items add column if not exists options jsonb;

-- 8. New in a city this week (api.actuent.ai/site/in/<city>/new and its RSS): the city's sites,
-- newest first, with when Actuent first saw them.
create or replace function new_in_city(c text, since timestamptz, max_results int default 60)
returns table (domain text, name text, category text, business jsonb, first_seen_at timestamptz)
language sql stable as $$
  select s.domain, s.name, s.category, s.business, s.first_seen_at
  from lawp_sites s
  where s.business is not null and lower(s.business->'address'->>'city') = lower(left(c, 100)) and s.status is null
    and s.first_seen_at >= since and coalesce(s.category, '') not in ('adult', 'gambling')
  order by s.first_seen_at desc
  limit least(max_results, 100)
$$;
revoke execute on function new_in_city(text, timestamptz, int) from public, anon, authenticated;

-- 14. Status history (api.actuent.ai/status): an hourly check that search answers (from the
-- speed alert job), and search speed per day, counted in the database.
create table if not exists uptime_checks (
  checked_at timestamptz primary key default now(),
  ok boolean not null,
  ms int
);
alter table uptime_checks enable row level security;

create or replace function search_speed_daily(days int default 30)
returns table (day date, searches bigint, median_ms int, p95_ms int)
language sql stable as $$
  select date_trunc('day', created_at)::date, count(*),
         percentile_cont(0.5) within group (order by duration_ms)::int,
         percentile_cont(0.95) within group (order by duration_ms)::int
  from searches
  where created_at >= now() - make_interval(days => least(days, 90)) and duration_ms is not null and coalesce(tier, 'free') <> 'test'
  group by 1 order by 1
$$;
revoke execute on function search_speed_daily(int) from public, anon, authenticated;
