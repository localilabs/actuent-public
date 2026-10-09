-- list_thirtythree.sql (8 Oct 2026): remembered preferences for Actuent Pro (opt-in). When a Pro user
-- asks their assistant to remember things (vegan, a budget, their home city, their currency), they're
-- kept here per API key (only the key's hash), used on that key's searches, and can be seen and
-- deleted in Analytics → Account (also erased by "Delete my data"). Safe to run any time; instant.
create table if not exists user_prefs (
  api_key text primary key,
  preferences text[] not null default '{}',
  home_city text,
  currency text,
  updated_at timestamptz not null default now()
);
alter table user_prefs enable row level security;
