-- List twelve (2026-09-28). Run once in Supabase → SQL Editor, after list_eleven.sql. Safe to run again.

-- Fix: Supabase refuses DELETE without WHERE, so the "did you mean" vocabulary was never built.
create or replace function build_search_vocab() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from search_vocab where true;
  insert into search_vocab (word, freq)
  select w, count(*) from (
    select regexp_split_to_table(lower(coalesce(name,'') || ' ' || coalesce(jsonb_path_query_array(pages::jsonb, '$.*.title')::text,'') || ' ' ||
      coalesce(jsonb_path_query_array(actions::jsonb, '$[*].intent')::text,'') || ' ' || replace(coalesce(category,''), '_', ' ')), '[^a-z]+') as w
    from lawp_sites where status is null and actions::text <> '[]'
  ) t
  where length(w) between 4 and 20
  group by w having count(*) >= 3;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function build_search_vocab() from public, anon, authenticated;

-- Fix: duplicate detection timed out grouping every site by content hash; an index makes it quick.
create index if not exists lawp_sites_content_hash_idx on lawp_sites (content_hash) where content_hash is not null and status is null;

-- Zero-result searches (ops page): how many results each search returned.
alter table searches add column if not exists result_count int;
create index if not exists searches_zero_idx on searches (created_at desc) where result_count = 0;

-- Autocomplete (/api/suggest): site names that start with, or closely resemble, what's typed.
create index if not exists lawp_sites_name_trgm_idx on lawp_sites using gin (lower(name) gin_trgm_ops) where status is null;
create or replace function suggest_sites(prefix text, max_results int default 8)
returns table (name text, domain text, category text)
language sql stable as $$
  select name, domain, category from (
    select s.name, s.domain, s.category, s.popularity_rank,
           case when lower(s.name) like lower(prefix) || '%' then 0 else 1 end as starts
    from lawp_sites s
    where s.status is null and s.actions::text <> '[]' and length(prefix) >= 2
      and (lower(s.name) like lower(prefix) || '%' or lower(s.name) % lower(prefix))
    order by starts, s.popularity_rank asc nulls last
    limit max_results * 3
  ) t
  order by starts, popularity_rank asc nulls last
  limit max_results
$$;
revoke execute on function suggest_sites(text, int) from public, anon, authenticated;

-- Filters on search (category=…, city=…).
create index if not exists lawp_sites_category_pop_idx on lawp_sites (category, popularity_rank) where status is null;

-- Speed: list_eleven.sql rebuilt the search column, and Postgres needs fresh statistics to plan
-- searches well again (searches were taking ~7 seconds). Takes a few seconds.
analyze lawp_sites;
analyze lawp_pages;
