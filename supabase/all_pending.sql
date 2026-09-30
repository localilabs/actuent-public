-- Lists 23, 24 and 25 together (2026-10-01). Run once in Supabase → SQL Editor, all at once.
-- Safe to run again. Takes seconds. Nothing here locks search or needs a vacuum.

-- ════════ list_twentythree.sql ════════

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
        and s2.domain not in (select d from searches q, unnest(q.domains) d where q.created_at > now() - interval '30 days' and d is not null)
      limit least(max_rows, 5000)
    )
    returning s.domain
  )
  insert into skipped_domains (domain, reason) select domain, 'minimal' from gone on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function sweep_minimal(int) from public, anon, authenticated;

-- ════════ list_twentyfour.sql ════════

-- 6. Weekly agent-readiness scores of the best-known sites, for "top movers" on the trends page.
-- About 1 MB a week; the prune job keeps 8 weeks.
create table if not exists site_scores (
  domain text not null,
  week date not null,
  score smallint not null,
  primary key (domain, week)
);
alter table site_scores enable row level security;
create index if not exists site_scores_week_idx on site_scores (week);

-- 7. Agencies: up to 20 client sites per Pro account, shown in Analytics → Clients.
create table if not exists tracked_sites (
  api_key text not null,          -- the owner's hashed API key
  domain text not null,
  label text,
  added_at timestamptz not null default now(),
  primary key (api_key, domain)
);
alter table tracked_sites enable row level security;

-- 14. The status page's speed per part of Actuent (from the hourly check): site pages, autocomplete, badges.
alter table uptime_checks add column if not exists site_ms int;
alter table uptime_checks add column if not exists autocomplete_ms int;
alter table uptime_checks add column if not exists badge_ms int;

-- ════════ list_twentyfive.sql ════════

-- 14. "Recently fixed" on the checklist page: which sites someone ran the checklist on (the domain and
-- when; nothing about who), so sites whose score rose afterwards can be shown.
create table if not exists checkups (
  domain text primary key,
  first_checked_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  first_score smallint
);
alter table checkups enable row level security;

