-- list_twentyeight.sql (5 Oct 2026): database diet before launch. The free database is ~87% full and
-- goes read-only at 100%. Sites outside the 30,000 best-known ones (and not claimed by an owner, and
-- not publishing their own lawp.json) keep only the first 1,200 characters of each stored page:
-- plenty for search and short answers, and their full pages come back on the next recrawl.
-- Popular, claimed and native sites are not touched.
--
-- Run at NIGHT, in this order, each part as its own query:
--   Part 1: sizes before (optional, to compare).
--   Part 2: the trim, 3,000 sites per run. Re-run until it returns 0.
--   Part 3: vacuum full lawp_sites;  (this is what actually frees the space; search pauses while it runs)
--   Part 1 again: sizes after.

-- ── Part 1: how big each column is ──────────────────────────────────────────────────────────
select * from lawp_sites_column_sizes();
select pg_size_pretty(pg_database_size(current_database())) as database_size;

-- ── Part 2: trim page text of less-visited sites (re-run until 0) ─────────────────────────────
create or replace function slim_quiet_sites(batch int default 3000) returns int language plpgsql as $$
declare n int;
begin
  with picked as (
    select s.domain from lawp_sites s
    where (s.popularity_rank is null or s.popularity_rank > 30000)
      and s.owner_key is null and s.native is not true
      and jsonb_typeof(s.pages) = 'object'
      and exists (select 1 from jsonb_each(case when jsonb_typeof(s.pages) = 'object' then s.pages else '{}'::jsonb end) e(k, v) where jsonb_typeof(v) = 'object' and length(v->>'content') > 1200)
    limit batch
  )
  update lawp_sites s set pages = (
    select jsonb_object_agg(k, case when jsonb_typeof(v) = 'object' and length(v->>'content') > 1200
      then jsonb_set(v, '{content}', to_jsonb(left(v->>'content', 1200))) else v end)
    from jsonb_each(s.pages) e(k, v)
  )
  from picked where s.domain = picked.domain;
  get diagnostics n = row_count;
  return n;
end $$;

set statement_timeout = '10min';
select slim_quiet_sites(3000) as sites_trimmed;

-- ── Part 3 (its own query, after Part 2 returns 0) ────────────────────────────────────────────
-- vacuum full lawp_sites;
