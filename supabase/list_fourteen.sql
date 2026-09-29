-- List fourteen (2026-09-29). Run once in Supabase → SQL Editor, after list_thirteen.sql. Safe to run again.

-- 13. Misspelt brand names ("spotfy", "notoin"): the closest names among well-known sites, by
-- trigram similarity, using the name index from list_thirteen.sql. Used for "did you mean".
create extension if not exists pg_trgm;
create index if not exists lawp_sites_name_trgm_idx on lawp_sites using gin (name gin_trgm_ops) where status is null;
create or replace function similar_site_name(q text)
returns table (domain text, name text, similarity real)
language sql stable as $$
  select s.domain, s.name, similarity(lower(s.name), lower(q))
  from lawp_sites s
  where s.status is null and s.name % q and s.popularity_rank is not null and s.popularity_rank <= 100000
  order by similarity(lower(s.name), lower(q)) desc, s.popularity_rank asc
  limit 3
$$;
revoke execute on function similar_site_name(text) from public, anon, authenticated;
