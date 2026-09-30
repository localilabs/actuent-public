-- List twenty-one (2026-09-30). Run once in Supabase → SQL Editor. Safe to run again. Takes seconds.

-- 2. Where the space in lawp_sites goes, per column (from a 2% sample, so it's quick), so we can
-- slim the biggest ones without guessing. Called by the watchdog and the inspect job.
create or replace function lawp_sites_column_sizes() returns table (column_name text, avg_bytes int, estimated_mb int)
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare c record; total bigint := (select reltuples::bigint from pg_class where relname = 'lawp_sites');
begin
  for c in select a.attname from pg_attribute a where a.attrelid = 'public.lawp_sites'::regclass and a.attnum > 0 and not a.attisdropped loop
    return query execute format('select %L::text, avg(pg_column_size(%I))::int, (avg(pg_column_size(%I)) * %s / 1048576)::int from lawp_sites tablesample system (2)', c.attname, c.attname, c.attname, total);
  end loop;
end $$;
revoke execute on function lawp_sites_column_sizes() from public, anon, authenticated;

-- 4. Product price history, thinned: everything from the last 30 days, then one price per product
-- per week. Run weekly by the prune job. Returns how many rows it removed.
create or replace function thin_price_history() returns int
language plpgsql security definer set search_path = public, pg_catalog as $$
declare n int;
begin
  delete from lawp_item_prices where ctid in (
    select ctid from (
      select ctid, row_number() over (partition by url, date_trunc('week', observed_at) order by observed_at desc) as rn
      from lawp_item_prices where observed_at < now() - interval '30 days'
    ) x where rn > 1
  );
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function thin_price_history() from public, anon, authenticated;

-- 5. Which countries a shop ships to (from its shipping policy page), so shoppers see shops that
-- deliver to them first. Two-letter country codes, e.g. {dk,se,de}.
alter table lawp_sites add column if not exists ships_to text[];

-- 12. The weekly "State of the AI web" email for anyone who signs up (double opt-in: nothing is
-- sent until the address is confirmed). Only the email address and dates are kept.
create table if not exists newsletter (
  email text primary key,
  token text not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz
);
alter table newsletter enable row level security;
