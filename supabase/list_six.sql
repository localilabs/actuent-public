-- List six (2026-09-27). Run once in Supabase → SQL Editor, after list_five.sql. Safe to run again.
-- LAWP 0.4 user accounts: Actuent's OAuth app registration at each site, and each user's connected
-- site accounts. Tokens and client secrets are stored encrypted (sealed with AES-256-GCM).

create table if not exists site_oauth_clients (
  domain text primary key,
  client_id text not null,
  client_secret text,               -- sealed
  registration_url text,
  created_at timestamptz not null default now()
);
alter table site_oauth_clients enable row level security;

create table if not exists user_site_accounts (
  api_key text not null,            -- sha256 hash of the Actuent API key
  domain text not null,
  tokens text not null,             -- sealed: access token, refresh token, expiry
  scopes text[],
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (api_key, domain)
);
alter table user_site_accounts enable row level security;
