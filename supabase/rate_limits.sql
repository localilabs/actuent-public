-- Rate limit counters shared by api.actuent.ai and agents.actuent.ai (src/utils/limits.ts).
-- Run once in Supabase → SQL Editor. Until then both fall back to in-memory limits.

create table if not exists rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);
create index if not exists rate_limits_window_idx on rate_limits (window_start);
alter table rate_limits enable row level security;

-- Adds one hit to this minute's window and returns true if the caller is over the limit.
create or replace function hit_rate_limit(k text, max_per_minute int) returns boolean
language plpgsql as $$
declare c int;
begin
  insert into rate_limits (key, window_start, count)
  values (k, date_trunc('minute', now()), 1)
  on conflict (key, window_start) do update set count = rate_limits.count + 1
  returning count into c;
  if random() < 0.01 then
    delete from rate_limits where window_start < now() - interval '10 minutes';
  end if;
  return c > max_per_minute;
end $$;

revoke execute on function hit_rate_limit(text, int) from public, anon, authenticated;
