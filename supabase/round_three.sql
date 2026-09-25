-- Round three (2026-09-26). Run once in Supabase → SQL Editor.
-- Business details, price history and search functions that return them. The code works before
-- this runs; these features switch on afterwards.

-- 3. Business details from schema.org data on the site (address, phone, opening hours, price range).
alter table lawp_sites add column if not exists business jsonb;

drop function if exists search_lawp_sites(text, int);
create or replace function search_lawp_sites(q text, max_results int default 50)
returns table (domain text, name text, pages jsonb, actions jsonb, native boolean, updated_at timestamptz, language text, business jsonb, rank real)
language sql stable as $$
  select s.domain, s.name, s.pages::jsonb, s.actions::jsonb, s.native, s.updated_at::timestamptz, s.language, s.business,
         ts_rank(s.search_text, lawp_or_query(q))
  from lawp_sites s where s.search_text @@ lawp_or_query(q) order by 9 desc limit max_results
$$;

-- 5. Price history: every price change is recorded, and each item keeps its previous price.
alter table lawp_items add column if not exists previous_price_eur numeric;
alter table lawp_items add column if not exists price_changed_at timestamptz;
create table if not exists lawp_item_prices (
  id bigserial primary key,
  url text not null,
  price numeric,
  currency text,
  price_eur numeric,
  observed_at timestamptz not null default now()
);
create index if not exists lawp_item_prices_url_idx on lawp_item_prices (url, observed_at desc);
alter table lawp_item_prices enable row level security;

drop function if exists search_lawp_items(text, numeric, int);
create or replace function search_lawp_items(q text, max_price_eur numeric default null, max_results int default 20)
returns table (domain text, url text, name text, price numeric, currency text, price_eur numeric, image text, available boolean,
               previous_price_eur numeric, price_changed_at timestamptz, rank real)
language sql stable as $$
  select i.domain, i.url, i.name, i.price, i.currency, i.price_eur, i.image, i.available,
         i.previous_price_eur, i.price_changed_at,
         ts_rank(i.search_text, lawp_or_query(q)) +
         ts_rank(i.search_text, nullif(replace(plainto_tsquery('simple', q)::text, ' & ', ' | '), '')::tsquery)
  from lawp_items i
  where (i.search_text @@ lawp_or_query(q)
         or i.search_text @@ nullif(replace(plainto_tsquery('simple', q)::text, ' & ', ' | '), '')::tsquery)
    and (max_price_eur is null or i.price_eur <= max_price_eur)
    and coalesce(i.available, true)
  order by 11 desc, i.price_eur asc nulls last
  limit max_results
$$;
