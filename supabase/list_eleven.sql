-- List eleven (2026-09-28). Run once in Supabase → SQL Editor, after list_ten.sql. Safe to run again.
-- Search quality: clicks, "did you mean", duplicates, phrases, category synonyms, human ratings.

create extension if not exists pg_trgm;

-- 1. Which results people open for a search (from api.actuent.ai/go links; no personal data:
-- only the search words and the site). Search gives often-opened results a small boost.
create table if not exists query_clicks (
  query text not null,
  domain text not null,
  clicks int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (query, domain)
);
alter table query_clicks enable row level security;
create or replace function add_query_click(q text, d text) returns void
language sql as $$
  insert into query_clicks (query, domain, clicks) values (lower(left(q, 200)), lower(d), 1)
  on conflict (query, domain) do update set clicks = query_clicks.clicks + 1, updated_at = now()
$$;
revoke execute on function add_query_click(text, text) from public, anon, authenticated;

-- 2. "Did you mean": words from site names, titles and keywords, with their counts, rebuilt
-- weekly (actuent-crawler/search_vocab.ts). Misspelt words are matched by similarity (pg_trgm).
create table if not exists search_vocab (word text primary key, freq int not null);
alter table search_vocab enable row level security;
create index if not exists search_vocab_trgm_idx on search_vocab using gin (word gin_trgm_ops);

create or replace function build_search_vocab() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from search_vocab;
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

-- The closest well-known word for each word of the search that the index doesn't know.
-- Returns null when every word is known (or nothing is close enough).
create or replace function did_you_mean(q text) returns text
language plpgsql stable as $$
declare w text; best text; out text := ''; changed boolean := false;
begin
  foreach w in array regexp_split_to_array(lower(trim(q)), '\s+') loop
    if length(w) < 4 or w !~ '^[a-z]+$' or exists (select 1 from search_vocab where word = w) then
      out := out || ' ' || w; continue;
    end if;
    select word into best from search_vocab where word % w order by similarity(word, w) desc, freq desc limit 1;
    if best is not null and similarity(best, w) >= 0.4 then out := out || ' ' || best; changed := true;
    else out := out || ' ' || w; end if;
  end loop;
  return case when changed then trim(out) else null end;
end $$;
revoke execute on function did_you_mean(text) from public, anon, authenticated;

-- 5. Mirrors and copies: different domains whose homepage content is identical (same content hash).
create or replace function content_duplicates(max_groups int default 500)
returns table (content_hash text, domains text[], ranks int[])
language sql stable as $$
  select content_hash, array_agg(domain order by popularity_rank asc nulls last, length(domain)), array_agg(popularity_rank order by popularity_rank asc nulls last, length(domain))
  from lawp_sites
  where content_hash is not null and status is null and owner_key is null and native is not true
  group by content_hash having count(*) between 2 and 20
  limit max_groups
$$;
revoke execute on function content_duplicates(int) from public, anon, authenticated;

-- 8. Category synonyms in the index: a hair & beauty site also matches "barber", "haircut",
-- "salon"…, even when its own text never says so.
create or replace function category_words(c text) returns text
language sql immutable as $$
  select case c
    when 'restaurant' then 'restaurant dining food dinner lunch eat'
    when 'cafe' then 'cafe coffee coffeeshop espresso brunch'
    when 'bar' then 'bar pub drinks cocktails beer wine'
    when 'bakery' then 'bakery bread pastry cakes'
    when 'hotel' then 'hotel accommodation stay rooms lodging'
    when 'travel' then 'travel trips flights holidays tours booking'
    when 'hair_beauty' then 'hairdresser barber haircut salon beauty nails'
    when 'spa_wellness' then 'spa massage wellness sauna'
    when 'fitness' then 'gym fitness workout training yoga'
    when 'dental' then 'dentist dental teeth'
    when 'health' then 'health doctor clinic medical'
    when 'events' then 'events tickets concerts shows'
    when 'museum_culture' then 'museum gallery exhibitions culture art'
    when 'shop_fashion' then 'clothing fashion clothes shoes apparel'
    when 'shop_beauty' then 'cosmetics skincare makeup beauty'
    when 'shop_electronics' then 'electronics gadgets computers phones'
    when 'shop_home' then 'furniture home decor interior'
    when 'shop_sports' then 'sports outdoor equipment sportswear'
    when 'shop_kids' then 'kids children toys baby'
    when 'shop_grocery' then 'groceries supermarket food'
    when 'shop' then 'shop store buy online shopping'
    when 'pets' then 'pets dogs cats pet supplies'
    when 'food_delivery' then 'food delivery takeaway order'
    when 'software' then 'software app saas tool platform'
    when 'developer' then 'developer api code programming'
    when 'ai' then 'ai artificial intelligence assistant'
    when 'finance' then 'finance money banking payments accounting'
    when 'news_media' then 'news media magazine journalism'
    when 'education' then 'education courses learning school'
    when 'real_estate' then 'real estate property homes rent'
    when 'legal' then 'legal lawyer law attorney'
    when 'automotive' then 'cars automotive vehicles'
    when 'home_services' then 'home services repair cleaning plumber electrician'
    when 'jobs' then 'jobs careers hiring employment'
    else '' end
$$;

do $$ begin
  if not exists (select 1 from information_schema.columns where table_name = 'lawp_sites' and column_name = 'search_text' and generation_expression like '%category_words%') then
    alter table lawp_sites drop column if exists search_text;
    alter table lawp_sites add column search_text tsvector generated always as (
      setweight(to_tsvector('english', coalesce(name,'') || ' ' || coalesce(domain,'')), 'A') ||
      setweight(to_tsvector('english', coalesce(jsonb_path_query_array(pages::jsonb, '$.*.title')::text,'')), 'B') ||
      setweight(to_tsvector('english', coalesce(jsonb_path_query_array(actions::jsonb, '$[*].intent')::text,'')), 'B') ||
      setweight(to_tsvector('english', replace(coalesce(category,''), '_', ' ') || ' ' || coalesce(business->>'type','') || ' ' || coalesce(business->'address'->>'city','')), 'B') ||
      setweight(to_tsvector('english', category_words(category)), 'C') ||
      setweight(to_tsvector('english', coalesce(jsonb_path_query_array(pages::jsonb, '$.*.content')::text,'')), 'C')
    ) stored;
  end if;
end $$;
create index if not exists lawp_sites_search_idx on lawp_sites using gin (search_text);

-- 7. Phrases: "project management" as a phrase ranks above sites that only have both words apart.
drop function if exists search_lawp_sites(text, int);
create or replace function search_lawp_sites(q text, max_results int default 50)
returns table (domain text, name text, pages jsonb, actions jsonb, native boolean, updated_at timestamptz, language text, business jsonb, category text, popularity_rank int, rank real)
language sql stable as $$
  with query as (select lawp_or_query(q) as any_word, plainto_tsquery('english', q) as all_words,
                        case when q ~ '\s' then phraseto_tsquery('english', q) end as phrase),
  every_word as (
    select s.domain, s.popularity_rank from lawp_sites s, query
    where query.all_words::text <> '' and s.search_text @@ query.all_words and s.status is null
    limit 5000
  ),
  candidates as (
    (select domain from every_word order by popularity_rank asc nulls last limit 2000)
    union
    (select s.domain from lawp_sites s, query
      where s.status is null and s.popularity_rank <= 20000 and s.search_text @@ query.any_word
      order by s.popularity_rank asc limit 1000)
  )
  select s.domain, s.name, s.pages::jsonb, s.actions::jsonb, s.native, s.updated_at::timestamptz, s.language, s.business, s.category, s.popularity_rank,
         (ts_rank(s.search_text, query.any_word)
          + case when query.all_words::text <> '' and s.search_text @@ query.all_words then 1 else 0 end
          + case when query.phrase is not null and query.phrase::text <> '' and s.search_text @@ query.phrase then 0.5 else 0 end
          + case when s.popularity_rank is not null then greatest(0, 6 - log(greatest(s.popularity_rank, 1))) / 12 else 0 end)::real
  from candidates c join lawp_sites s using (domain), query
  order by 11 desc limit max_results
$$;

-- 13. Human ratings of search results (ops page): is this a good result for this search?
create table if not exists search_ratings (
  id bigserial primary key,
  query text not null,
  domain text not null,
  position int,
  good boolean not null,
  rated_at timestamptz not null default now()
);
alter table search_ratings enable row level security;
create index if not exists search_ratings_rated_idx on search_ratings (rated_at desc);
