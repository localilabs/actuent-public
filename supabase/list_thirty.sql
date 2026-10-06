-- list_thirty.sql (6 Oct 2026): page watches (actuent_watch_page, Pro). "Tell me when this page
-- changes / when 'tickets on sale' appears / when 'sold out' disappears". Checked daily by
-- actuent-crawler page_watches.ts. Safe to run any time.
create table if not exists page_watches (
  id bigint generated always as identity primary key,
  api_key text not null,               -- hashed key (sha-256), never the key itself
  url text not null,
  watch_for text not null default 'change',  -- 'change' | 'appears' | 'disappears'
  phrase text not null default '',
  label text,
  last_hash text,
  last_seen boolean,
  webhook_url text,
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  alerted_at timestamptz,
  unique (api_key, url, watch_for, phrase)
);
alter table page_watches enable row level security;
