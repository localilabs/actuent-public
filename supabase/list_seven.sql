-- List seven (2026-09-27). Run once in Supabase → SQL Editor, after list_six.sql. Safe to run again.

-- 10. Faster search: query expansions (translation + related terms) are cached for 30 days.
create table if not exists query_expansions (
  query text primary key,
  english text not null,
  terms text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table query_expansions enable row level security;

-- 15. Abuse protection: blocked IPs (salted hashes) and API keys (hashes), until a given time.
create table if not exists blocked (
  value text primary key,           -- ipHash(ip) or keyHash(key)
  kind text not null,               -- 'ip' | 'key'
  reason text,
  until timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists blocked_until_idx on blocked (until);
alter table blocked enable row level security;
