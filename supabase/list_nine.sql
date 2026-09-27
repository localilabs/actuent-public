-- List nine (2026-09-27). Run once in Supabase → SQL Editor, after list_eight.sql. Safe to run again.

-- Better search ranking. search_lawp_sites capped its candidates at 1500 rows in no particular
-- order, so for common words ("software", "online", "payments") the well-known sites were often
-- never looked at: "accounting software" missed QuickBooks, Xero and FreshBooks although their
-- descriptions say exactly that. Candidates are now the best-known matching sites (Tranco rank),
-- and popularity adds a small bonus to the text rank.
create index if not exists lawp_sites_popularity_idx on lawp_sites (popularity_rank) where status is null;

drop function if exists search_lawp_sites(text, int);
create or replace function search_lawp_sites(q text, max_results int default 50)
returns table (domain text, name text, pages jsonb, actions jsonb, native boolean, updated_at timestamptz, language text, business jsonb, category text, popularity_rank int, rank real)
language sql stable as $$
  with query as (select lawp_or_query(q) as any_word, plainto_tsquery('english', q) as all_words),
  candidates as (
    -- Every word matches: the best-known sites first, then the rest.
    (select s.domain from lawp_sites s, query where query.all_words::text <> '' and s.search_text @@ query.all_words and s.status is null
      order by s.popularity_rank asc nulls last limit 2000)
    union
    -- Any word matches: only the best-known sites (a common word matches tens of thousands).
    (select s.domain from lawp_sites s, query where s.search_text @@ query.any_word and s.status is null and s.popularity_rank is not null
      order by s.popularity_rank asc limit 1500)
  )
  select s.domain, s.name, s.pages::jsonb, s.actions::jsonb, s.native, s.updated_at::timestamptz, s.language, s.business, s.category, s.popularity_rank,
         (ts_rank(s.search_text, query.any_word)
          + case when query.all_words::text <> '' and s.search_text @@ query.all_words then 1 else 0 end
          -- Popularity: up to +0.5 for the top sites, fading out around rank 1M.
          + case when s.popularity_rank is not null then greatest(0, 6 - log(greatest(s.popularity_rank, 1))) / 12 else 0 end)::real
  from candidates c join lawp_sites s using (domain), query
  order by 11 desc limit max_results
$$;
