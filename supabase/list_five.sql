-- List five (2026-09-26). Run once in Supabase → SQL Editor, after list_four.sql.
-- Safe to run again.
-- Service/menu search, AI bot access checks and visits sent by Actuent. The code works before this
-- runs; features switch on after. Nothing here changes updated_at.

-- 1. Find a service or dish: search the services and menu items (with prices) that businesses
-- publish, near a place or in a city.
create or replace function search_lawp_offers(q text, city text default null, lat double precision default null,
                                              lon double precision default null, radius_m double precision default 3000,
                                              max_results int default 40)
returns table (domain text, name text, business jsonb, offer jsonb, rank real)
language sql stable as $$
  with query as (
    select nullif(replace(plainto_tsquery('simple', q)::text, ' & ', ' | '), '')::tsquery as tsq,
           plainto_tsquery('simple', q) as all_words
  )
  select s.domain, s.name, s.business, o.offer,
         ts_rank(to_tsvector('simple', coalesce(o.offer->>'name', '') || ' ' || coalesce(o.offer->>'category', '') || ' ' || coalesce(s.business->>'type', '')), query.tsq)
         + case when to_tsvector('simple', coalesce(o.offer->>'name', '') || ' ' || coalesce(o.offer->>'category', '')) @@ query.all_words then 1 else 0 end
  from lawp_sites s
  cross join lateral jsonb_array_elements(s.business->'offers') as o(offer)
  cross join query
  where s.business ? 'offers' and s.status is null
    and to_tsvector('simple', coalesce(o.offer->>'name', '') || ' ' || coalesce(o.offer->>'category', '') || ' ' || coalesce(s.business->>'type', '') || ' ' || coalesce(s.name, '')) @@ query.tsq
    and (
      (lat is null and city is null)
      or (lat is not null and s.business ? 'geo'
        and abs((s.business->'geo'->>'lat')::float - lat) <= radius_m / 111320.0
        and abs((s.business->'geo'->>'lon')::float - lon) <= radius_m / (111320.0 * greatest(cos(radians(lat)), 0.01)))
      or (city is not null and lower(s.business->'address'->>'city') = lower(city))
    )
  order by 5 desc
  limit max_results
$$;

-- 9. AI bot access: which AI crawlers and assistants a site's robots.txt blocks.
alter table lawp_sites add column if not exists ai_access jsonb;
create index if not exists lawp_sites_ai_access_idx on lawp_sites ((ai_access is null));

-- 10. Visits sent by Actuent: clicks on links Actuent gave to AI agents, per site and day.
create table if not exists link_clicks (
  domain text not null,
  day date not null,
  clicks int not null default 0,
  primary key (domain, day)
);
alter table link_clicks enable row level security;
create or replace function add_link_click(p_domain text)
returns void language sql as $$
  insert into link_clicks (domain, day, clicks) values (p_domain, current_date, 1)
  on conflict (domain, day) do update set clicks = link_clicks.clicks + 1
$$;
