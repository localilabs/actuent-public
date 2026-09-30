-- List twenty (2026-09-30): find the missing space, and delete the "minimal" sites.
-- Run in Supabase → SQL Editor, one part at a time, in order.

-- ── Part 1: is a vacuum still running? (Run this first.) ─────────────────────────────────────
-- Any row here means yes: wait for it to finish (don't stop it) before Part 3.
select pid, now() - query_start as running_for, left(query, 80) as query
from pg_stat_activity where query ilike '%vacuum%' and pid <> pg_backend_pid();

-- ── Part 2: where every megabyte is, all schemas (so Actuent's watchdog can see it too). ──────
create or replace function db_size_all() returns table (schema_name text, name text, bytes bigint)
language sql stable security definer set search_path = public, pg_catalog as $$
  select n.nspname::text, c.relname::text, pg_total_relation_size(c.oid)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'm') and n.nspname not in ('pg_catalog', 'information_schema')
  order by 3 desc limit 25
$$;
revoke execute on function db_size_all() from public, anon, authenticated;
select schema_name, name, pg_size_pretty(bytes) from db_size_all();

-- ── Part 3: delete the minimal sites. ────────────────────────────────────────────────────────
-- "Minimal" sites are ones Actuent couldn't read ("Website at x"); keyword search already hides
-- them. Kept anyway: the 20,000 best-known sites (brand lookups use them), claimed sites, sites
-- with their own LAWP, and sites with products.
-- Deleted domains go on a small skip list (a few MB), so the mass crawler doesn't add them back.
-- A search for one of them still crawls it on demand.
create table if not exists skipped_domains (
  domain text primary key,
  reason text not null,
  skipped_at timestamptz not null default now()
);
alter table skipped_domains enable row level security;

-- Run this statement again until it says "DELETE 0" (about 10 runs; 5,000 sites each, a few
-- seconds per run, so the editor never times out and search keeps working in between).
with gone as (
  delete from lawp_sites s
  where s.ctid in (
    select s2.ctid from lawp_sites s2
    where s2.conversion = 'minimal' and s2.owner_key is null and coalesce(s2.native, false) = false
      and (s2.popularity_rank is null or s2.popularity_rank > 20000)
      and not exists (select 1 from lawp_items i where i.domain = s2.domain)
    limit 5000
  )
  returning s.domain
)
insert into skipped_domains (domain, reason) select domain, 'minimal' from gone on conflict do nothing;

-- ── Part 4: at a quiet moment, give the space back. ─────────────────────────────────────────
-- Locks the sites table for a few minutes (search waits). Run it on its own:
-- vacuum full lawp_sites;
