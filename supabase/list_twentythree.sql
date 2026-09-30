-- List twenty-three (2026-09-30). Run once in Supabase → SQL Editor. Safe to run again. Takes seconds.

-- 1. Indexes that searches never use (0 uses since they were made), or that repeat another index
-- on the same column. About 11 MB back, and every save to these tables gets a little faster.
drop index if exists lawp_sites_backlog_idx;      -- reconvert backlog (finished), 0 uses
drop index if exists lawp_sites_embedding_idx;    -- embeddings were never filled, 0 uses
drop index if exists lawp_sites_minimal_idx;      -- 0 uses
drop index if exists lawp_items_price_idx;        -- 0 uses (price filters use the search index)
drop index if exists searches_domains_idx;        -- 0 uses
drop index if exists lawp_sites_domain_idx;       -- same column as lawp_sites_domain_key (unique)
drop index if exists lawp_pages_full_url_idx;     -- same column as lawp_pages_full_url_key (unique)

-- 3. Monthly sweep: minimal sites ("Website at x": Actuent couldn't read them) that are over 30 days
-- old go, like the big clean-up, onto the skip list. Kept: the 20,000 best-known sites, claimed
-- sites, sites with their own LAWP, sites with products, and any site searched in the last 30 days.
create or replace function sweep_minimal(max_rows int default 5000) returns int
language plpgsql security definer set search_path = public, pg_catalog as $$
declare n int;
begin
  with gone as (
    delete from lawp_sites s
    where s.ctid in (
      select s2.ctid from lawp_sites s2
      where s2.conversion = 'minimal' and s2.owner_key is null and coalesce(s2.native, false) = false
        and (s2.popularity_rank is null or s2.popularity_rank > 20000)
        and coalesce(s2.first_seen_at, s2.updated_at) < now() - interval '30 days'
        and not exists (select 1 from lawp_items i where i.domain = s2.domain)
        and s2.domain not in (select unnest(q.domains) from searches q where q.created_at > now() - interval '30 days' and q.domains is not null)
      limit least(max_rows, 5000)
    )
    returning s.domain
  )
  insert into skipped_domains (domain, reason) select domain, 'minimal' from gone on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function sweep_minimal(int) from public, anon, authenticated;
