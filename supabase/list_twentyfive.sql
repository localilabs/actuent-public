-- List twenty-five (2026-09-30). Run once in Supabase → SQL Editor. Safe to run again. Takes seconds.

-- 14. "Recently fixed" on the checklist page: which sites someone ran the checklist on (the domain and
-- when; nothing about who), so sites whose score rose afterwards can be shown.
create table if not exists checkups (
  domain text primary key,
  first_checked_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  first_score smallint
);
alter table checkups enable row level security;
