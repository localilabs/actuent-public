-- list_thirtytwo.sql (7 Oct 2026): actuent_find_service ("a haircut under €30 in Copenhagen") timed
-- out: it looked for sites that list services with prices by reading the whole sites table. This
-- index holds only those sites, so the search reads a few thousand rows instead of ~100,000.
-- Safe to run any time; takes under a minute.
create index if not exists lawp_sites_offers_idx on lawp_sites (domain) where business ? 'offers' and status is null;
analyze lawp_sites;

-- Feedback from inside the chat (actuent_feedback): when a user says an answer was wrong, their
-- assistant reports which tool, the question and what was wrong. No user details are kept.
create table if not exists answer_feedback (
  id bigint generated always as identity primary key,
  tool text,
  question text not null,
  problem text not null,
  expected text,
  tier text,
  created_at timestamptz not null default now()
);
create index if not exists answer_feedback_created_idx on answer_feedback (created_at desc);
alter table answer_feedback enable row level security;
