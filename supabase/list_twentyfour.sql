-- List twenty-four (2026-09-30). Run once in Supabase → SQL Editor. Safe to run again. Takes seconds.

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
