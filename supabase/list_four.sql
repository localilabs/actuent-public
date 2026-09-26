-- List four (2026-09-26). Run once in Supabase → SQL Editor, AFTER next_list.sql.
-- Categories, city directories, parked/duplicate flags, back-in-stock alerts and endpoint
-- reliability. The code works before this runs; features switch on after.
-- Nothing here changes updated_at, so the reconvert job's order is unaffected.

-- 11. Categories (restaurant, hair_beauty, shop_fashion, software…), set by the categorize job.
alter table lawp_sites add column if not exists category text;
create index if not exists lawp_sites_category_idx on lawp_sites (category);

-- 12. City directory pages: sites by city (from their schema.org address) and category.
create index if not exists lawp_sites_city_idx on lawp_sites (lower(business->'address'->>'city')) where business is not null;
create or replace function lawp_city_categories(min_sites int default 3)
returns table (city text, category text, sites bigint)
language sql stable as $$
  select initcap(lower(business->'address'->>'city')), category, count(*)
  from lawp_sites
  where business->'address'->>'city' is not null and category is not null and status is null
  group by 1, 2 having count(*) >= min_sites
  order by 3 desc
  limit 5000
$$;

-- 14. Parked domains and duplicates (brand.co.uk → brand.com) are flagged, not deleted, and left
-- out of search. status: 'parked' | 'duplicate'.
alter table lawp_sites add column if not exists status text;
alter table lawp_sites add column if not exists duplicate_of text;
alter table lawp_sites add column if not exists checked_at timestamptz;
create index if not exists lawp_sites_checked_idx on lawp_sites (checked_at nulls first);

drop function if exists search_lawp_sites(text, int);
create or replace function search_lawp_sites(q text, max_results int default 50)
returns table (domain text, name text, pages jsonb, actions jsonb, native boolean, updated_at timestamptz, language text, business jsonb, category text, rank real)
language sql stable as $$
  select s.domain, s.name, s.pages::jsonb, s.actions::jsonb, s.native, s.updated_at::timestamptz, s.language, s.business, s.category,
         ts_rank(s.search_text, lawp_or_query(q))
  from lawp_sites s where s.search_text @@ lawp_or_query(q) and s.status is null order by 10 desc limit max_results
$$;

create or replace function search_lawp_businesses(q text, city text default null, lat double precision default null,
                                                  lon double precision default null, radius_m double precision default 3000,
                                                  max_results int default 20)
returns table (domain text, name text, business jsonb, rank real)
language sql stable as $$
  select s.domain, s.name, s.business,
         case when q is null or q = '' then 0 else ts_rank(s.search_text, lawp_or_query(q)) end
  from lawp_sites s
  where s.business is not null and s.status is null
    and (q is null or q = '' or s.search_text @@ lawp_or_query(q))
    and (
      (lat is not null and s.business ? 'geo'
        and abs((s.business->'geo'->>'lat')::float - lat) <= radius_m / 111320.0
        and abs((s.business->'geo'->>'lon')::float - lon) <= radius_m / (111320.0 * greatest(cos(radians(lat)), 0.01)))
      or (city is not null and lower(s.business->'address'->>'city') = lower(city))
    )
  order by 4 desc
  limit max_results
$$;

-- 2. Back-in-stock alerts: a watch can be for price drops, availability, or both.
alter table price_watches add column if not exists notify_price boolean not null default true;
alter table price_watches add column if not exists notify_stock boolean not null default false;
alter table price_watches add column if not exists last_available boolean;

-- 8. Endpoint reliability: every LAWP Checker test and the daily endpoint check.
create table if not exists lawp_checks (
  id bigserial primary key,
  domain text not null,
  action_id text not null,
  ok boolean not null,
  status int,
  ms int,
  source text not null default 'checker',   -- 'checker' | 'daily'
  created_at timestamptz not null default now()
);
create index if not exists lawp_checks_domain_idx on lawp_checks (domain, created_at desc);
alter table lawp_checks enable row level security;
