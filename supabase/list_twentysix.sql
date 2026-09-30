-- List twenty-six (2026-10-01). Run once in Supabase → SQL Editor. Safe to run again. Takes seconds.

-- Lawpy streaks: which days a connect-game player (a random code made in their browser, nothing else)
-- used Actuent through their AI, so docs.actuent.ai/connect can show their streak and Lawpy level.
create table if not exists player_days (
  code text not null,
  day date not null,
  primary key (code, day)
);
alter table player_days enable row level security;
