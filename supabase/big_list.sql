-- Big list round (2026-09-26). Run once in Supabase → SQL Editor.
-- The code works before this runs (it falls back), but these features switch on after it:
-- hashed API keys, rate-limit headers, freshness, products, referrals.

-- ---------------------------------------------------------------------------
-- 14. Hashed API keys. Keys are looked up by their SHA-256 hash; logs and other tables store
--     only the hash. A trigger fills key_hash whenever actuent.ai writes a key.
-- ---------------------------------------------------------------------------
alter table api_keys add column if not exists key_hash text;
update api_keys set key_hash = encode(sha256(convert_to(key, 'UTF8')), 'hex') where key is not null and key_hash is null;
create unique index if not exists api_keys_key_hash_idx on api_keys (key_hash);

create or replace function api_keys_set_hash() returns trigger language plpgsql as $$
begin
  if new.key is not null then
    new.key_hash := encode(sha256(convert_to(new.key, 'UTF8')), 'hex');
  end if;
  return new;
end $$;
drop trigger if exists api_keys_hash on api_keys;
create trigger api_keys_hash before insert or update of key on api_keys
  for each row execute function api_keys_set_hash();

-- Replace raw keys already stored in logs and other tables with their hash.
update searches    set api_key   = encode(sha256(convert_to(api_key, 'UTF8')), 'hex')   where api_key   is not null and api_key   !~ '^[0-9a-f]{64}$';
update action_log  set api_key   = encode(sha256(convert_to(api_key, 'UTF8')), 'hex')   where api_key   is not null and api_key   !~ '^[0-9a-f]{64}$';
update webhooks    set api_key   = encode(sha256(convert_to(api_key, 'UTF8')), 'hex')   where api_key   is not null and api_key   !~ '^[0-9a-f]{64}$';
update lawp_sites  set owner_key = encode(sha256(convert_to(owner_key, 'UTF8')), 'hex') where owner_key is not null and owner_key !~ '^[0-9a-f]{64}$';
do $$ begin
  if exists (select 1 from information_schema.tables where table_name = 'agent_sessions') then
    execute $q$update agent_sessions set api_key = encode(sha256(convert_to(api_key, 'UTF8')), 'hex') where api_key is not null and api_key !~ '^[0-9a-f]{64}$'$q$;
  end if;
end $$;
delete from rate_limits where key like '%:key:%';
-- The plain `key` column in api_keys is still used by actuent.ai (Lovable) to show users their key.
-- Once actuent.ai only shows the key once at creation, clear it with:
--   update api_keys set key = null;   (and make the column nullable first if needed)

-- ---------------------------------------------------------------------------
-- 10. Rate-limit headers: same counter, but returns the count so responses can say what's left.
-- ---------------------------------------------------------------------------
create or replace function hit_rate_limit_count(k text) returns int
language plpgsql as $$
declare c int;
begin
  insert into rate_limits (key, window_start, count)
  values (k, date_trunc('minute', now()), 1)
  on conflict (key, window_start) do update set count = rate_limits.count + 1
  returning count into c;
  if random() < 0.01 then
    delete from rate_limits where window_start < now() - interval '10 minutes';
  end if;
  return c;
end $$;
revoke execute on function hit_rate_limit_count(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5 + 6. Language of the original site, and freshness in search results.
-- ---------------------------------------------------------------------------
alter table lawp_sites add column if not exists language text;
drop function if exists search_lawp_sites(text, int);
create or replace function search_lawp_sites(q text, max_results int default 50)
returns table (domain text, name text, pages jsonb, actions jsonb, native boolean, updated_at timestamptz, language text, rank real)
language sql stable as $$
  select s.domain, s.name, s.pages::jsonb, s.actions::jsonb, s.native, s.updated_at::timestamptz, s.language,
         ts_rank(s.search_text, lawp_or_query(q))
  from lawp_sites s where s.search_text @@ lawp_or_query(q) order by 8 desc limit max_results
$$;

-- ---------------------------------------------------------------------------
-- 1 + 4. Products with prices (Shopify stores, WooCommerce, the WordPress plugin).
-- ---------------------------------------------------------------------------
create table if not exists lawp_items (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  url text not null unique,
  name text not null,
  price numeric,
  currency text,
  price_eur numeric,
  image text,
  available boolean,
  source text,
  updated_at timestamptz not null default now(),
  search_text tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(domain, '')), 'B')
  ) stored
);
create index if not exists lawp_items_search_idx on lawp_items using gin (search_text);
create index if not exists lawp_items_domain_idx on lawp_items (domain);
create index if not exists lawp_items_price_idx on lawp_items (price_eur);
alter table lawp_items enable row level security;
alter table lawp_sites add column if not exists products_crawled_at timestamptz;

-- Products matching a query, optionally under a maximum price (in EUR), cheapest-relevant first.
create or replace function search_lawp_items(q text, max_price_eur numeric default null, max_results int default 20)
returns table (domain text, url text, name text, price numeric, currency text, price_eur numeric, image text, available boolean, rank real)
language sql stable as $$
  select i.domain, i.url, i.name, i.price, i.currency, i.price_eur, i.image, i.available,
         ts_rank(i.search_text, lawp_or_query(q)) +
         ts_rank(i.search_text, nullif(replace(plainto_tsquery('simple', q)::text, ' & ', ' | '), '')::tsquery)
  from lawp_items i
  where (i.search_text @@ lawp_or_query(q)
         or i.search_text @@ nullif(replace(plainto_tsquery('simple', q)::text, ' & ', ' | '), '')::tsquery)
    and (max_price_eur is null or i.price_eur <= max_price_eur)
    and coalesce(i.available, true)
  order by 9 desc, i.price_eur asc nulls last
  limit max_results
$$;

-- ---------------------------------------------------------------------------
-- 11. Referrals: each Pro key gets a code; a referred subscription earns the referrer a free month.
-- ---------------------------------------------------------------------------
create table if not exists referrals (
  code text primary key,
  key_hash text unique not null,
  email text,
  clicks int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists referral_conversions (
  id uuid primary key default gen_random_uuid(),
  code text not null references referrals(code),
  referred_email text,
  stripe_session text unique,
  credited boolean not null default false,
  created_at timestamptz not null default now()
);
alter table referrals enable row level security;
alter table referral_conversions enable row level security;
