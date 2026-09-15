-- Posting to Meta and the weekly shot list
-- (docs/superpowers/specs/2026-09-15-meta-posting-design.md).
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table social_accounts (
  id               uuid primary key default gen_random_uuid(),
  platform         text not null check (platform in ('instagram','facebook','threads')),
  handle           text not null,
  external_id      text not null,
  status           text not null check (status in ('ready','not_ready','reconnect_needed')),
  reason           text,
  token_secret_id  uuid,
  token_expires_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (platform, external_id)
);

-- source_id is deliberately not a foreign key: it points at either a draft or
-- a carousel, and drafts already has a relationship with tasks.
create table posts (
  id            uuid primary key default gen_random_uuid(),
  source_kind   text not null check (source_kind in ('draft','carousel')),
  source_id     uuid not null,
  account_id    uuid not null references social_accounts(id) on delete cascade,
  platform      text not null check (platform in ('instagram','facebook','threads')),
  caption       text not null,
  image_paths   text[] not null default '{}',
  scheduled_for timestamptz not null,
  status        text not null default 'scheduled'
                check (status in ('scheduled','posting','posted','failed','cancelled')),
  external_id   text,
  permalink     text,
  error         text,
  attempts      int not null default 0,
  claimed_at    timestamptz,
  posted_at     timestamptz,
  created_at    timestamptz not null default now()
);
create index posts_due_idx on posts (status, scheduled_for);
create index posts_source_idx on posts (source_kind, source_id);

create table shot_lists (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid references tasks(id) on delete set null,
  week_start date not null,
  entries    jsonb not null,
  created_at timestamptz not null default now()
);
create index shot_lists_week_idx on shot_lists (week_start desc, created_at desc);

create table photos (
  id         uuid primary key default gen_random_uuid(),
  day        date not null unique,
  path       text not null,
  created_at timestamptz not null default now()
);

alter table drafts add column photo_path text;
alter table drafts_dryrun add column photo_path text;

alter table tasks drop constraint if exists tasks_kind_check;

alter table social_accounts enable row level security;
alter table posts enable row level security;
alter table shot_lists enable row level security;
alter table photos enable row level security;
revoke all on table social_accounts, posts, shot_lists, photos from public, anon, authenticated;
grant all on table social_accounts, posts, shot_lists, photos to service_role;

insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

create or replace function set_account_token(p_account uuid, p_token text, p_expires timestamptz)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  sid uuid;
begin
  select token_secret_id into sid from social_accounts where id = p_account;
  if sid is null then
    sid := vault.create_secret(p_token, 'social_token_' || p_account::text);
    update social_accounts
       set token_secret_id = sid, token_expires_at = p_expires, updated_at = now()
     where id = p_account;
  else
    perform vault.update_secret(sid, p_token);
    update social_accounts
       set token_expires_at = p_expires, updated_at = now()
     where id = p_account;
  end if;
end;
$$;

create or replace function get_account_token(p_account uuid)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select ds.decrypted_secret
    from social_accounts sa
    join vault.decrypted_secrets ds on ds.id = sa.token_secret_id
   where sa.id = p_account;
$$;

-- Moving a row from scheduled to posting is the only claim. skip locked
-- lets two overlapping cron runs each take different rows, never the same.
create or replace function claim_due_posts(p_limit int)
returns setof posts
language sql
as $$
  update posts
     set status = 'posting', claimed_at = now(), attempts = attempts + 1
   where id in (
     select id from posts
      where status = 'scheduled' and scheduled_for <= now()
      order by scheduled_for
      for update skip locked
      limit p_limit
   )
  returning *;
$$;

revoke execute on function set_account_token(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function get_account_token(uuid) from public, anon, authenticated;
revoke execute on function claim_due_posts(int) from public, anon, authenticated;
grant execute on function set_account_token(uuid, text, timestamptz) to service_role;
grant execute on function get_account_token(uuid) to service_role;
grant execute on function claim_due_posts(int) to service_role;
