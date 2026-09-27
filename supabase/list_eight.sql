-- List eight (2026-09-27). Run once in Supabase → SQL Editor, after list_seven.sql. Safe to run again.

-- 8. Security: account connect links work once.
create table if not exists used_tokens (
  nonce text primary key,
  used_at timestamptz not null default now()
);
alter table used_tokens enable row level security;
