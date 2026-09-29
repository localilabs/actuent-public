-- List thirteen (2026-09-29). Run once in Supabase → SQL Editor, after list_twelve.sql. Safe to run again.

-- 18. Popular searches answered from a shared cache (every server instance, not just one), so
-- repeated searches on launch day answer in well under a second. 30-minute lifetime.
create table if not exists search_cache (
  key text primary key,
  body jsonb not null,
  expires_at timestamptz not null
);
alter table search_cache enable row level security;
create index if not exists search_cache_expires_idx on search_cache (expires_at);

-- 19. Common-word searches only look among the 20,000 best-known sites in their any-word branch;
-- a search index on just those sites makes that branch an index lookup instead of a table scan.
create index if not exists lawp_sites_top_search_idx on lawp_sites using gin (search_text) where status is null and popularity_rank <= 20000;

-- 3b. Name searches ("localilabs", "british museum") look sites up by their exact name. Without
-- this index that is a scan of the whole table (5-8 seconds); with it, milliseconds.
create extension if not exists pg_trgm;
create index if not exists lawp_sites_name_trgm_idx on lawp_sites using gin (name gin_trgm_ops) where status is null;

-- 3. Official websites found through Wikidata for famous names ("sagrada familia" → sagradafamilia.org),
-- cached so each name is looked up once.
create table if not exists name_websites (
  query text primary key,
  domain text,
  label text,
  checked_at timestamptz not null default now()
);
alter table name_websites enable row level security;

-- 16. Searches rewritten straight after another one ("cheap flights" → "cheap flights to rome"):
-- a sign the first results weren't good enough. Only the two searches are kept, never who searched.
create table if not exists query_reformulations (
  from_query text not null,
  to_query text not null,
  times int not null default 1,
  updated_at timestamptz not null default now(),
  primary key (from_query, to_query)
);
alter table query_reformulations enable row level security;
create or replace function add_reformulation(a text, b text) returns void
language sql as $$
  insert into query_reformulations (from_query, to_query) values (lower(left(a, 120)), lower(left(b, 120)))
  on conflict (from_query, to_query) do update set times = query_reformulations.times + 1, updated_at = now()
$$;
revoke execute on function add_reformulation(text, text) from public, anon, authenticated;

-- 17. Searches worth a closer look, found weekly by actuent-crawler/misses.ts.
create table if not exists search_misses (
  query text primary key,
  kind text not null,          -- 'zero_results' | 'no_clicks' | 'reformulated'
  searches int not null default 0,
  suggestion text,             -- a site that was queued for it, when one was found
  checked_at timestamptz not null default now()
);
alter table search_misses enable row level security;

analyze lawp_sites;
