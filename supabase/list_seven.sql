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

-- 10. Faster search: rank a capped set of candidates instead of every row that shares a common
-- word ("software" matches thousands of sites). Sites matching all the words come first, then any.
create or replace function search_lawp_sites(q text, max_results int default 50)
returns table (domain text, name text, pages jsonb, actions jsonb, native boolean, updated_at timestamptz, language text, business jsonb, category text, rank real)
language sql stable as $$
  with query as (select lawp_or_query(q) as any_word, plainto_tsquery('english', q) as all_words),
  candidates as (
    (select s.domain from lawp_sites s, query where query.all_words::text <> '' and s.search_text @@ query.all_words and s.status is null limit 1500)
    union
    (select s.domain from lawp_sites s, query where s.search_text @@ query.any_word and s.status is null limit 1500)
  )
  select s.domain, s.name, s.pages::jsonb, s.actions::jsonb, s.native, s.updated_at::timestamptz, s.language, s.business, s.category,
         ts_rank(s.search_text, query.any_word) + case when query.all_words::text <> '' and s.search_text @@ query.all_words then 1 else 0 end
  from candidates c join lawp_sites s using (domain), query
  order by 10 desc limit max_results
$$;

create or replace function search_lawp_pages(q text, max_results int default 50)
returns table (domain text, path text, title text, content text, actions jsonb, rank real)
language sql stable as $$
  with query as (select lawp_or_query(q) as any_word),
  candidates as (select p.ctid as row_id from lawp_pages p, query where p.search_text @@ query.any_word limit 2000)
  select p.domain, p.path, p.title, p.content, p.actions::jsonb, ts_rank(p.search_text, query.any_word)
  from candidates c join lawp_pages p on p.ctid = c.row_id, query
  order by 6 desc limit max_results
$$;
