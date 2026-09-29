-- List fifteen (2026-09-29). Run once in Supabase → SQL Editor. Safe to run again. Takes seconds.
--
-- Name searches ("localilabs", "spotfy") must use the name index from list_twelve.sql, which is on
-- lower(name). Looking names up any other way reads the whole sites table each time, which used up
-- the database's disk allowance on 2026-09-29. These two functions use the index.

-- Sites whose name is exactly this (any capitals): "notion" → Notion.
create or replace function sites_named(n text)
returns table (domain text, name text, pages jsonb, actions jsonb, native boolean, updated_at timestamptz, language text, business jsonb, category text, popularity_rank int, owner_key text)
language sql stable as $$
  select s.domain, s.name, s.pages::jsonb, s.actions::jsonb, s.native, s.updated_at::timestamptz, s.language, s.business, s.category, s.popularity_rank, s.owner_key
  from lawp_sites s
  where s.status is null
    and lower(s.name) like replace(replace(replace(lower(left(n, 100)), '\', '\\'), '%', '\%'), '_', '\_')
  order by s.popularity_rank asc nulls last
  limit 5
$$;
revoke execute on function sites_named(text) from public, anon, authenticated;

-- Misspelt names ("spotfy" → Spotify), now through the same index.
create or replace function similar_site_name(q text)
returns table (domain text, name text, similarity real)
language sql stable as $$
  select s.domain, s.name, similarity(lower(s.name), lower(q))
  from lawp_sites s
  where s.status is null and lower(s.name) % lower(left(q, 100)) and s.popularity_rank is not null and s.popularity_rank <= 100000
  order by similarity(lower(s.name), lower(q)) desc, s.popularity_rank asc
  limit 3
$$;
revoke execute on function similar_site_name(text) from public, anon, authenticated;

-- City pages (api.actuent.ai/site/in/<city>): businesses in a city through the city index
-- (list_four.sql). Their old filter read the whole sites table, and search engines visit these pages.
create or replace function sites_in_city(c text, cat text default null, max_results int default 300)
returns table (domain text, name text, category text, native boolean, actions jsonb, business jsonb)
language sql stable as $$
  select s.domain, s.name, s.category, s.native, s.actions::jsonb, s.business
  from lawp_sites s
  where s.business is not null and lower(s.business->'address'->>'city') = lower(left(c, 100)) and s.status is null
    and (cat is null or s.category = cat) and coalesce(s.category, '') not in ('adult', 'gambling')
  order by s.native desc, s.updated_at desc
  limit least(max_results, 300)
$$;
revoke execute on function sites_in_city(text, text, int) from public, anon, authenticated;

-- The name index list_fourteen.sql tried to add has the same name as list_twelve's, so it was
-- skipped; nothing to remove. Expired cached searches go straight away (the cache refills itself).
delete from search_cache where expires_at < now();
