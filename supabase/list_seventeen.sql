-- List seventeen (2026-09-29). Run once in Supabase → SQL Editor. Safe to run again. Takes seconds.

-- 5. "Ask this site" widget insights: questions visitors asked on a site, grouped (no one's identity,
-- no IP; questions with an email address or long numbers are never stored). Site owners see them in
-- Actuent Analytics, with the ones their pages couldn't answer first.
create table if not exists ask_questions (
  domain text not null,
  question text not null,
  times int not null default 1,
  unanswered int not null default 0,
  last_at timestamptz not null default now(),
  primary key (domain, question)
);
alter table ask_questions enable row level security;
create index if not exists ask_questions_domain_idx on ask_questions (domain, times desc);

create or replace function add_ask_question(d text, q text, answered boolean) returns void
language sql as $$
  insert into ask_questions (domain, question, unanswered) values (lower(left(d, 120)), lower(left(q, 120)), case when answered then 0 else 1 end)
  on conflict (domain, question) do update set times = ask_questions.times + 1,
    unanswered = ask_questions.unanswered + case when answered then 0 else 1 end, last_at = now()
$$;
revoke execute on function add_ask_question(text, text, boolean) from public, anon, authenticated;

-- 6. Change alerts for claimed sites: what the site looked like at the last daily check (opening
-- hours, which action links worked), so a change can be spotted and the owner told.
create table if not exists site_watch (
  domain text primary key,
  hours jsonb,
  special_hours jsonb,
  broken_links jsonb not null default '[]',
  checked_at timestamptz not null default now()
);
alter table site_watch enable row level security;
alter table lawp_sites add column if not exists change_alerts boolean not null default true;
