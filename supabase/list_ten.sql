-- List ten (2026-09-28). Run once in Supabase → SQL Editor, after list_nine.sql. Safe to run again.

-- Counters with any window length (rate_limits only keeps per-minute windows for 10 minutes).
-- Used for the "busy right now" banner (busy notices in the last 5 minutes) and the free-tier
-- scraper guard (searches per IP per hour). Keys never contain raw IPs, only salted hashes.
create table if not exists usage_counters (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);
alter table usage_counters enable row level security;

create or replace function hit_counter(k text, window_seconds int) returns int
language plpgsql as $$
declare c int; w timestamptz := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);
begin
  insert into usage_counters (key, window_start, count) values (k, w, 1)
  on conflict (key, window_start) do update set count = usage_counters.count + 1
  returning count into c;
  if random() < 0.005 then delete from usage_counters where window_start < now() - interval '2 days'; end if;
  return c;
end $$;

-- Reads a counter without adding to it (the current window plus the previous one).
create or replace function peek_counter(k text, window_seconds int) returns int
language sql stable as $$
  select coalesce(sum(count), 0)::int from usage_counters
  where key = k and window_start >= to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds) - make_interval(secs => window_seconds)
$$;
revoke execute on function hit_counter(text, int) from public, anon, authenticated;
revoke execute on function peek_counter(text, int) from public, anon, authenticated;

-- Sites people asked for while it was too busy to visit them live: the crawler adds or refreshes
-- them within the hour (actuent-crawler/crawl_queue.ts).
create table if not exists crawl_queue (
  domain text primary key,
  requested_at timestamptz not null default now(),
  requests int not null default 1,
  done_at timestamptz,
  outcome text
);
alter table crawl_queue enable row level security;
create index if not exists crawl_queue_pending_idx on crawl_queue (requested_at) where done_at is null;

create or replace function queue_crawl(d text) returns void
language sql as $$
  insert into crawl_queue (domain) values (lower(d))
  on conflict (domain) do update set requests = crawl_queue.requests + 1, requested_at = now(), done_at = null, outcome = null
    where crawl_queue.done_at is not null or crawl_queue.requested_at < now() - interval '1 hour'
$$;
revoke execute on function queue_crawl(text) from public, anon, authenticated;

-- Database size for the ops page (the free plan stops at 500 MB): total and the biggest tables.
create or replace function db_size() returns table (name text, bytes bigint)
language sql stable security definer set search_path = public, pg_catalog as $$
  select '(total)', pg_database_size(current_database())
  union all
  select c.relname::text, pg_total_relation_size(c.oid)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  order by 2 desc limit 16
$$;
revoke execute on function db_size() from public, anon, authenticated;

-- Faster search under load. With many searches at once, sorting every site that shares a common
-- word by popularity made each search take seconds. The any-word branch now looks only among the
-- 20,000 best-known sites (an index lookup), and the every-word branch is capped before sorting.
create index if not exists lawp_sites_top_idx on lawp_sites (popularity_rank) where status is null and popularity_rank <= 20000;

drop function if exists search_lawp_sites(text, int);
create or replace function search_lawp_sites(q text, max_results int default 50)
returns table (domain text, name text, pages jsonb, actions jsonb, native boolean, updated_at timestamptz, language text, business jsonb, category text, popularity_rank int, rank real)
language sql stable as $$
  with query as (select lawp_or_query(q) as any_word, plainto_tsquery('english', q) as all_words),
  every_word as (
    select s.domain, s.popularity_rank from lawp_sites s, query
    where query.all_words::text <> '' and s.search_text @@ query.all_words and s.status is null
    limit 5000
  ),
  candidates as (
    (select domain from every_word order by popularity_rank asc nulls last limit 2000)
    union
    (select s.domain from lawp_sites s, query
      where s.status is null and s.popularity_rank <= 20000 and s.search_text @@ query.any_word
      order by s.popularity_rank asc limit 1000)
  )
  select s.domain, s.name, s.pages::jsonb, s.actions::jsonb, s.native, s.updated_at::timestamptz, s.language, s.business, s.category, s.popularity_rank,
         (ts_rank(s.search_text, query.any_word)
          + case when query.all_words::text <> '' and s.search_text @@ query.all_words then 1 else 0 end
          + case when s.popularity_rank is not null then greatest(0, 6 - log(greatest(s.popularity_rank, 1))) / 12 else 0 end)::real
  from candidates c join lawp_sites s using (domain), query
  order by 11 desc limit max_results
$$;
