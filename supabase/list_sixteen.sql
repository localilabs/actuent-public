-- List sixteen (2026-09-29). Run once in Supabase → SQL Editor, after list_fifteen.sql. Safe to run again. Takes seconds.

-- 2. Counters in batches: each server counts searches in memory and adds several at once, instead
-- of one database write per search (rate limits per minute, the scraper guard per hour).
create or replace function hit_rate_limit_add(k text, n int) returns int
language plpgsql as $$
declare c int;
begin
  insert into rate_limits (key, window_start, count)
  values (k, date_trunc('minute', now()), greatest(n, 1))
  on conflict (key, window_start) do update set count = rate_limits.count + greatest(n, 1)
  returning count into c;
  if random() < 0.01 then delete from rate_limits where window_start < now() - interval '10 minutes'; end if;
  return c;
end $$;
revoke execute on function hit_rate_limit_add(text, int) from public, anon, authenticated;

create or replace function hit_counter_add(k text, window_seconds int, n int) returns int
language plpgsql as $$
declare c int; w timestamptz := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);
begin
  insert into usage_counters (key, window_start, count) values (k, w, greatest(n, 0))
  on conflict (key, window_start) do update set count = usage_counters.count + greatest(n, 0)
  returning count into c;
  if random() < 0.005 then delete from usage_counters where window_start < now() - interval '2 days'; end if;
  return c;
end $$;
revoke execute on function hit_counter_add(text, int, int) from public, anon, authenticated;

-- 3. The search log in batches: servers save up to 25 searches in one insert (plain insert of an
-- array, no function needed). Nothing to add here.

-- 9 + 10. Benchmark rows keep each query's result and database time (details->rows); the ops
-- page compares the last two runs. Nothing to add here either.
