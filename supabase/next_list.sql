-- Next list (2026-09-26). Run once in Supabase → SQL Editor.
-- Barcodes for cross-shop price comparison, price-drop alerts, events, businesses near a place,
-- weekly score emails and AI bot traffic. The code works before this runs; features switch on after.

-- 10. Same product in different shops: barcodes (GTIN/EAN/UPC) from Shopify and WooCommerce.
alter table lawp_items add column if not exists gtin text;
create index if not exists lawp_items_gtin_idx on lawp_items (gtin) where gtin is not null;

drop function if exists search_lawp_items(text, numeric, int);
create or replace function search_lawp_items(q text, max_price_eur numeric default null, max_results int default 20)
returns table (domain text, url text, name text, price numeric, currency text, price_eur numeric, image text, available boolean,
               previous_price_eur numeric, price_changed_at timestamptz, gtin text, rank real)
language sql stable as $$
  select i.domain, i.url, i.name, i.price, i.currency, i.price_eur, i.image, i.available,
         i.previous_price_eur, i.price_changed_at, i.gtin,
         ts_rank(i.search_text, lawp_or_query(q)) +
         ts_rank(i.search_text, nullif(replace(plainto_tsquery('simple', q)::text, ' & ', ' | '), '')::tsquery)
  from lawp_items i
  where (i.search_text @@ lawp_or_query(q)
         or i.search_text @@ nullif(replace(plainto_tsquery('simple', q)::text, ' & ', ' | '), '')::tsquery)
    and (max_price_eur is null or i.price_eur <= max_price_eur)
    and coalesce(i.available, true)
  order by 12 desc, i.price_eur asc nulls last
  limit max_results
$$;

-- 4. Price-drop alerts (Pro): watch a product, get an email or webhook when its price drops.
create table if not exists price_watches (
  id bigserial primary key,
  api_key text not null,            -- sha256 hash of the API key, like everywhere else
  url text not null,
  domain text not null,
  name text,
  target_price_eur numeric,         -- alert only at or below this price (null = any drop)
  last_price_eur numeric,
  webhook_url text,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  unique (api_key, url)
);
create index if not exists price_watches_domain_idx on price_watches (domain);
alter table price_watches enable row level security;

-- 7. Events from schema.org data on websites (concerts, classes, workshops).
create table if not exists lawp_events (
  id bigserial primary key,
  domain text not null,
  url text not null,
  name text not null,
  description text,
  start_date timestamptz not null,
  end_date timestamptz,
  venue text,
  city text,
  country text,
  lat double precision,
  lon double precision,
  price numeric,
  currency text,
  online boolean default false,
  updated_at timestamptz not null default now(),
  unique (url, start_date)
);
create index if not exists lawp_events_start_idx on lawp_events (start_date);
create index if not exists lawp_events_city_idx on lawp_events (lower(city));
alter table lawp_events enable row level security;

-- 8. Businesses from the index near a place: by location from their schema.org data, or by city.
create index if not exists lawp_sites_business_idx on lawp_sites ((business is not null)) where business is not null;
create or replace function search_lawp_businesses(q text, city text default null, lat double precision default null,
                                                  lon double precision default null, radius_m double precision default 3000,
                                                  max_results int default 20)
returns table (domain text, name text, business jsonb, rank real)
language sql stable as $$
  select s.domain, s.name, s.business,
         case when q is null or q = '' then 0 else ts_rank(s.search_text, lawp_or_query(q)) end
  from lawp_sites s
  where s.business is not null
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

-- 11. Weekly score emails for claimed sites.
alter table lawp_sites add column if not exists last_score int;
alter table lawp_sites add column if not exists score_emails boolean not null default true;
alter table lawp_sites add column if not exists score_emailed_at timestamptz;

-- 12. AI bot visits reported by the WordPress plugin and the Cloudflare Worker (claimed sites only).
create table if not exists bot_hits (
  domain text not null,
  bot text not null,
  day date not null,
  hits int not null default 0,
  primary key (domain, bot, day)
);
alter table bot_hits enable row level security;
create or replace function add_bot_hits(p_domain text, p_bot text, p_day date, p_hits int)
returns void language sql as $$
  insert into bot_hits (domain, bot, day, hits) values (p_domain, p_bot, p_day, p_hits)
  on conflict (domain, bot, day) do update set hits = bot_hits.hits + excluded.hits
$$;
