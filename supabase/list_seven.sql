-- List seven (2026-09-27). Run once in Supabase → SQL Editor, after list_six.sql. Safe to run again.

-- 10. Faster search: query expansions (translation + related terms) are cached for 30 days.
create table if not exists query_expansions (
  query text primary key,
  english text not null,
  terms text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table query_expansions enable row level security;

-- 15. Abuse protection: blocked IPs (salted hashes) and API keys (hashes), until a given time.
create table if not exists blocked (
  value text primary key,           -- ipHash(ip) or keyHash(key)
  kind text not null,               -- 'ip' | 'key'
  reason text,
  until timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists blocked_until_idx on blocked (until);
alter table blocked enable row level security;

-- 10/11. Popularity: each site's Tranco rank (set weekly by actuent-crawler/popularity.ts).
alter table lawp_sites add column if not exists popularity_rank int;
create or replace function set_popularity(domains text[], ranks int[])
returns void language sql as $$
  update lawp_sites s set popularity_rank = v.rank
  from unnest(domains, ranks) as v(domain, rank) where s.domain = v.domain
$$;

-- 10. Faster search: rank a capped set of candidates instead of every row that shares a common
-- word ("software" matches thousands of sites). Sites matching all the words come first, then any.
drop function if exists search_lawp_sites(text, int);
create or replace function search_lawp_sites(q text, max_results int default 50)
returns table (domain text, name text, pages jsonb, actions jsonb, native boolean, updated_at timestamptz, language text, business jsonb, category text, popularity_rank int, rank real)
language sql stable as $$
  with query as (select lawp_or_query(q) as any_word, plainto_tsquery('english', q) as all_words),
  candidates as (
    (select s.domain from lawp_sites s, query where query.all_words::text <> '' and s.search_text @@ query.all_words and s.status is null limit 1500)
    union
    (select s.domain from lawp_sites s, query where s.search_text @@ query.any_word and s.status is null limit 1500)
  )
  select s.domain, s.name, s.pages::jsonb, s.actions::jsonb, s.native, s.updated_at::timestamptz, s.language, s.business, s.category, s.popularity_rank,
         ts_rank(s.search_text, query.any_word) + case when query.all_words::text <> '' and s.search_text @@ query.all_words then 1 else 0 end
  from candidates c join lawp_sites s using (domain), query
  order by 11 desc limit max_results
$$;

create or replace function search_lawp_pages(q text, max_results int default 50)
returns table (domain text, path text, title text, content text, actions jsonb, rank real)
language sql stable as $$
  with query as (select lawp_or_query(q) as any_word),
  candidates as (select p.ctid as row_id from lawp_pages p, query where p.search_text @@ query.any_word limit 2000)
  select p.domain, p.path, p.title, p.content, p.actions::jsonb, ts_rank(p.search_text, query.any_word)
  from candidates c join lawp_pages p on p.ctid = c.row_id, query
  order by 6 desc limit max_results
$$;

-- 11. Search quality benchmark results (actuent-crawler/bench, weekly).
create table if not exists search_benchmarks (
  id bigserial primary key,
  run_at timestamptz not null default now(),
  queries int, hit_at_1 numeric, hit_at_5 numeric, mrr numeric, p50_ms int, p95_ms int,
  details jsonb
);
alter table search_benchmarks enable row level security;

-- 14. Ops dashboard: search durations, category counts and conversion progress in one call.
alter table searches add column if not exists duration_ms int;
create or replace function ops_overview()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'categories', (select coalesce(jsonb_object_agg(coalesce(nullif(category, ''), 'uncategorised'), n), '{}') from (select category, count(*) n from lawp_sites group by category) c),
    'conversion', (select coalesce(jsonb_object_agg(coalesce(conversion, 'unknown'), n), '{}') from (select conversion, count(*) n from lawp_sites group by conversion) v),
    'flagged', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from lawp_sites where status is not null group by status) f),
    'search_ms_24h', (select jsonb_build_object('count', count(*), 'p50', percentile_disc(0.5) within group (order by duration_ms), 'p95', percentile_disc(0.95) within group (order by duration_ms))
                      from searches where created_at > now() - interval '24 hours' and duration_ms is not null),
    'blocked_now', (select count(*) from blocked where until > now())
  )
$$;

-- 6. Checkout links: Shopify variant ids, so agents can hand over a ready cart.
alter table lawp_items add column if not exists variant_id text;
drop function if exists search_lawp_items(text, numeric, int);
create or replace function search_lawp_items(q text, max_price_eur numeric default null, max_results int default 20)
returns table (domain text, url text, name text, price numeric, currency text, price_eur numeric, image text, available boolean,
               previous_price_eur numeric, price_changed_at timestamptz, gtin text, source text, variant_id text, rank real)
language sql stable as $$
  select i.domain, i.url, i.name, i.price, i.currency, i.price_eur, i.image, i.available,
         i.previous_price_eur, i.price_changed_at, i.gtin, i.source, i.variant_id,
         ts_rank(i.search_text, lawp_or_query(q)) +
         ts_rank(i.search_text, nullif(replace(plainto_tsquery('simple', q)::text, ' & ', ' | '), '')::tsquery)
  from lawp_items i
  where (i.search_text @@ lawp_or_query(q)
         or i.search_text @@ nullif(replace(plainto_tsquery('simple', q)::text, ' & ', ' | '), '')::tsquery)
    and (max_price_eur is null or i.price_eur <= max_price_eur)
    and coalesce(i.available, true)
  order by 14 desc, i.price_eur asc nulls last
  limit max_results
$$;
