-- list_thirtytwo.sql (7 Oct 2026): actuent_find_service ("a haircut under €30 in Copenhagen") timed
-- out: it looked for sites that list services with prices by reading the whole sites table. This
-- index holds only those sites, so the search reads a few thousand rows instead of ~100,000.
-- Safe to run any time; takes under a minute.
create index if not exists lawp_sites_offers_idx on lawp_sites (domain) where business ? 'offers' and status is null;
analyze lawp_sites;
