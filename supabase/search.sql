-- Full-text search over every indexed LAWP site/page.
-- Run once in Supabase → SQL Editor. src/utils/search.ts calls these via /rest/v1/rpc/.
-- Until this is run, search.ts falls back to its old 200-row sample.

alter table lawp_sites add column if not exists search_text tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(name,'') || ' ' || coalesce(domain,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(jsonb_path_query_array(pages::jsonb, '$.*.title')::text,'')), 'B') ||
    setweight(to_tsvector('english', coalesce(jsonb_path_query_array(actions::jsonb, '$[*].intent')::text,'')), 'B') ||
    setweight(to_tsvector('english', coalesce(jsonb_path_query_array(pages::jsonb, '$.*.content')::text,'')), 'C')
  ) stored;
create index if not exists lawp_sites_search_idx on lawp_sites using gin (search_text);

alter table lawp_pages add column if not exists search_text tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(domain,'') || ' ' || coalesce(path,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(jsonb_path_query_array(actions::jsonb, '$[*].intent')::text,'')), 'B') ||
    setweight(to_tsvector('english', coalesce(content,'')), 'C')
  ) stored;
create index if not exists lawp_pages_search_idx on lawp_pages using gin (search_text);

-- Words are OR-ed so partial matches still count; ts_rank puts sites matching more words first.
create or replace function lawp_or_query(q text) returns tsquery language sql immutable as $$
  select nullif(replace(plainto_tsquery('english', q)::text, ' & ', ' | '), '')::tsquery
$$;

create or replace function search_lawp_sites(q text, max_results int default 50)
returns table (domain text, name text, pages jsonb, actions jsonb, rank real) language sql stable as $$
  select s.domain, s.name, s.pages::jsonb, s.actions::jsonb, ts_rank(s.search_text, lawp_or_query(q))
  from lawp_sites s where s.search_text @@ lawp_or_query(q) order by 5 desc limit max_results
$$;

create or replace function search_lawp_pages(q text, max_results int default 50)
returns table (domain text, path text, title text, content text, actions jsonb, rank real) language sql stable as $$
  select p.domain, p.path, p.title, p.content, p.actions::jsonb, ts_rank(p.search_text, lawp_or_query(q))
  from lawp_pages p where p.search_text @@ lawp_or_query(q) order by 6 desc limit max_results
$$;
