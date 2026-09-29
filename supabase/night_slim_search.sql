-- Slimmer search index (2026-09-29). Run at NIGHT (after 22:00 Danish time): it rebuilds the search
-- column and its indexes, and search is slow for the few minutes that takes. Safe to run again (it
-- does nothing the second time). Afterwards, run this on its own (a new query with just this line)
-- to give the freed space back:   vacuum lawp_sites;
--
-- The search column held every page's full text a second time. Now it keeps the first 3,000
-- characters of page text per site (plus names, titles, actions, category and city, as before): the
-- sites table and its biggest index shrink, and searches read less from disk.

set statement_timeout = '15min';

do $$ begin
  if not exists (select 1 from information_schema.columns where table_name = 'lawp_sites' and column_name = 'search_text' and generation_expression like '%3000%') then
    alter table lawp_sites drop column if exists search_text;
    alter table lawp_sites add column search_text tsvector generated always as (
      setweight(to_tsvector('english', coalesce(name,'') || ' ' || coalesce(domain,'')), 'A') ||
      setweight(to_tsvector('english', coalesce(jsonb_path_query_array(pages::jsonb, '$.*.title')::text,'')), 'B') ||
      setweight(to_tsvector('english', coalesce(jsonb_path_query_array(actions::jsonb, '$[*].intent')::text,'')), 'B') ||
      setweight(to_tsvector('english', replace(coalesce(category,''), '_', ' ') || ' ' || coalesce(business->>'type','') || ' ' || coalesce(business->'address'->>'city','')), 'B') ||
      setweight(to_tsvector('english', category_words(category)), 'C') ||
      setweight(to_tsvector('english', left(coalesce(jsonb_path_query_array(pages::jsonb, '$.*.content')::text,''), 3000)), 'C')
    ) stored;
  end if;
end $$;

-- Dropping the column dropped its indexes: back again (list_eleven.sql, list_thirteen.sql).
create index if not exists lawp_sites_search_idx on lawp_sites using gin (search_text);
create index if not exists lawp_sites_top_search_idx on lawp_sites using gin (search_text) where status is null and popularity_rank <= 20000;

-- Fresh statistics for the query planner.
analyze lawp_sites;
