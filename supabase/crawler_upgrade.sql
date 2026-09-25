-- Crawler upgrade (2026-09-26). Run once in Supabase → SQL Editor.
-- Records how each LAWP was made, so the daily re-convert job can upgrade rule-based entries
-- to AI conversions when LLM quota is available.
alter table lawp_sites add column if not exists conversion text;
update lawp_sites set conversion = case
  when native then 'native'
  when actions::jsonb = '[]'::jsonb then 'minimal'
  else 'llm' end
where conversion is null;
create index if not exists lawp_sites_conversion_idx on lawp_sites (conversion, updated_at);

-- Optional: remove minimal entries for infrastructure hosts (DNS/CDN/ad servers, not websites).
-- They never become useful. Uncomment to run:
-- delete from lawp_sites
--  where actions::jsonb = '[]'::jsonb and owner_key is null
--    and domain ~* '(^|\.)(awsdns-[0-9]+|akamai[a-z0-9]*|akadns[a-z0-9]*|edgekey|edgesuite|cloudfront|fastly[a-z0-9]*|gstatic|googleapis|googleusercontent|doubleclick|googlesyndication|googletagmanager|googleadservices|googlevideo|ggpht|ytimg|fbcdn|amazonaws|azureedge|azurefd|trafficmanager|msedge|windowsupdate|digicert|root-servers|gtld-servers|nstld|ocsp|[a-z0-9]*cdn[0-9]*|dns[0-9]*|ntp[0-9]*|app-measurement|crashlytics|scorecardresearch|adnxs|nr-data|dnsowl)\.';
