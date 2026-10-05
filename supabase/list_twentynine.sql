-- list_twentynine.sql (5 Oct 2026): Pro users' per-tool usage (Analytics → usage) is kept 35 days.
-- The counter function used to delete every counter older than 2 days now and then; it now leaves
-- the per-tool daily counts ("tool_day:…") alone (prune_data.ts removes those after 35 days).
-- Safe to run any time.
create or replace function hit_counter_add(k text, window_seconds int, n int) returns int
language plpgsql as $$
declare c int; w timestamptz := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);
begin
  insert into usage_counters (key, window_start, count) values (k, w, greatest(n, 0))
  on conflict (key, window_start) do update set count = usage_counters.count + greatest(n, 0)
  returning count into c;
  if random() < 0.005 then delete from usage_counters where window_start < now() - interval '2 days' and key not like 'tool_day:%'; end if;
  return c;
end $$;
revoke execute on function hit_counter_add(text, int, int) from public, anon, authenticated;
