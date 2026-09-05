create extension if not exists pgcrypto;

create table agents (
  id              uuid primary key default gen_random_uuid(),
  key             text unique not null,
  display_name    text not null,
  department      text not null,
  level           int  not null default 1 check (level between 1 and 4),
  max_level       int  not null default 4 check (max_level between 1 and 4),
  streak          int  not null default 0,
  recent_verdicts text[] not null default '{}',
  instructions    text not null default '',
  turn_cap        int  not null default 12,
  can_publish     boolean not null default false,
  enabled         boolean not null default true,
  created_at      timestamptz not null default now()
);

create table tasks (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references agents(id) on delete cascade,
  kind        text not null,
  state       text not null default 'queued'
              check (state in ('queued','running','done','failed')),
  due_at      timestamptz not null default now(),
  claimed_at  timestamptz,
  finished_at timestamptz,
  error       text,
  created_at  timestamptz not null default now()
);
create index tasks_pickup_idx on tasks (state, due_at);

create table drafts (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  agent_id   uuid not null references agents(id) on delete cascade,
  body       text not null,
  status     text not null default 'pending'
             check (status in ('pending','approved','declined')),
  created_at timestamptz not null default now()
);
create index drafts_queue_idx on drafts (agent_id, status);

-- dry-run output never mixes with real drafts
create table drafts_dryrun (like drafts including all);

create table approvals (
  id         uuid primary key default gen_random_uuid(),
  draft_id   uuid not null references drafts(id) on delete cascade,
  verdict    text not null
             check (verdict in ('approved','approved_with_edit','declined')),
  reason     text,
  created_at timestamptz not null default now()
);

create table feedback (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid not null references agents(id) on delete cascade,
  reason     text not null,
  created_at timestamptz not null default now()
);

create table events (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid references agents(id) on delete set null,
  task_id    uuid references tasks(id) on delete set null,
  kind       text not null,
  detail     jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Claims exactly one due task. SKIP LOCKED means two workers, or one cron
-- that fired twice, can never claim the same row.
create or replace function claim_next_task()
returns setof tasks
language plpgsql
as $$
declare
  picked uuid;
begin
  select id into picked
    from tasks
   where state = 'queued'
     and due_at <= now()
   order by due_at
   for update skip locked
   limit 1;

  if picked is null then
    return;
  end if;

  return query
    update tasks
       set state = 'running', claimed_at = now()
     where id = picked
    returning *;
end $$;
