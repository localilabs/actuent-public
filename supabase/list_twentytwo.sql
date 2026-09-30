-- List twenty-two (2026-09-30). Run once in Supabase → SQL Editor. Safe to run again. Takes seconds.
-- Changes nothing: it only adds a way for Actuent's jobs to see which indexes are big and whether
-- searches ever use them, so unused ones can be dropped to free space.

create or replace function index_usage() returns table (table_name text, index_name text, bytes bigint, scans bigint)
language sql stable security definer set search_path = public, pg_catalog as $$
  select s.relname::text, s.indexrelname::text, pg_relation_size(s.indexrelid), s.idx_scan
  from pg_stat_user_indexes s
  where s.schemaname = 'public'
  order by 3 desc limit 40
$$;
revoke execute on function index_usage() from public, anon, authenticated;
