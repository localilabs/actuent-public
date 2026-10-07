-- list_thirtyone.sql (7 Oct 2026): messages from AI assistants to businesses (actuent_contact_business):
-- questions, messages and booking requests, sent by email with the user's address as reply-to, plus
-- businesses that asked not to get them. Owners see their messages in Analytics → Inbox.
-- Safe to run any time.
create table if not exists action_messages (
  id bigint generated always as identity primary key,
  token text not null unique,            -- secret for the Accept/Decline links and status checks
  api_key text not null,                 -- sender's hashed key
  domain text not null,
  kind text not null,                    -- 'question' | 'message' | 'booking_request'
  to_email text not null,
  from_name text,
  reply_to text not null,
  body text not null,
  details jsonb,                         -- booking: date, time, party size
  status text not null default 'sent',   -- sent | accepted | declined
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create index if not exists action_messages_domain_idx on action_messages (domain, created_at desc);
create index if not exists action_messages_key_idx on action_messages (api_key, created_at desc);
alter table action_messages enable row level security;

create table if not exists business_optouts (
  domain text primary key,
  created_at timestamptz not null default now()
);
alter table business_optouts enable row level security;
