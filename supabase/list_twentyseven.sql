-- list_twentyseven.sql (5 Oct 2026): faster event lookups in web search ("comedy chicago this week",
-- "markets in copenhagen"). Search looks events up by words anywhere in the name, description, venue
-- and city (ilike '%word%'), which plain indexes can't help with; trigram indexes can.
-- Safe to run any time and to re-run. Takes a few seconds.

create extension if not exists pg_trgm;

create index if not exists lawp_events_name_trgm on lawp_events using gin (name gin_trgm_ops);
create index if not exists lawp_events_venue_trgm on lawp_events using gin (venue gin_trgm_ops);
create index if not exists lawp_events_city_trgm on lawp_events using gin (city gin_trgm_ops);
create index if not exists lawp_events_description_trgm on lawp_events using gin (description gin_trgm_ops);

analyze lawp_events;

-- Check: the four new indexes and the table's size.
select indexname, pg_size_pretty(pg_relation_size(indexname::regclass)) as size
from pg_indexes where tablename = 'lawp_events' and indexname like '%trgm';
