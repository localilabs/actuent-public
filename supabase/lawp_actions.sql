-- LAWP actions round (2026-09-25). Run once in Supabase → SQL Editor, after search.sql.
-- Until this runs: native-LAWP ranking/badges, verified ownership and the action log are off,
-- and the code falls back to the previous behaviour.

-- Sites that publish their own /.well-known/lawp.json, and who has verified ownership of a site.
alter table lawp_sites add column if not exists native boolean not null default false;
alter table lawp_sites add column if not exists owner_key text;
create index if not exists lawp_sites_owner_key_idx on lawp_sites (owner_key);

-- search_lawp_sites now also returns `native` (the return type changes, so drop first).
drop function if exists search_lawp_sites(text, int);
create or replace function search_lawp_sites(q text, max_results int default 50)
returns table (domain text, name text, pages jsonb, actions jsonb, native boolean, rank real) language sql stable as $$
  select s.domain, s.name, s.pages::jsonb, s.actions::jsonb, s.native, ts_rank(s.search_text, lawp_or_query(q))
  from lawp_sites s where s.search_text @@ lawp_or_query(q) order by 6 desc limit max_results
$$;

-- Every action an agent executed (or tried to) through actuent_execute_action.
create table if not exists action_log (
  id uuid primary key default gen_random_uuid(),
  api_key text not null,
  domain text not null,
  action_id text not null,
  action_name text,
  input text,
  executed boolean not null default false,
  status int,
  result text,
  created_at timestamptz not null default now()
);
create index if not exists action_log_api_key_idx on action_log (api_key, created_at desc);
create index if not exists action_log_domain_idx on action_log (domain, created_at desc);
alter table action_log enable row level security;
