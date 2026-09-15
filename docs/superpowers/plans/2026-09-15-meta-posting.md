# Meta Posting with a Weekly Shot List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Denis posts approved daily posts and sent carousels to Instagram, Facebook Pages and Threads, now or at a scheduled time, and gets a weekly shot list whose photos are attached to the matching daily post.

**Architecture:** Pure rules and publishers live in `src/posting/` with injected HTTP so they test without Meta. A `posts` table is the queue; a Postgres `pg_cron` job calls a secret-protected Next route every minute, which claims due rows atomically and publishes them. Tokens are stored in Supabase Vault behind service-role-only functions. The shot list is a new Strategist task kind run by the existing Mac worker.

**Tech Stack:** Node ESM + TypeScript, vitest, Supabase (Postgres, Storage, Vault, pg_cron, pg_net), Next.js 16 app in `web/`, Meta Graph API and Threads API via `fetch`.

**Spec:** `docs/superpowers/specs/2026-09-15-meta-posting-design.md`

## Global Constraints

- Nothing posts without Denis ticking an account and pressing Post now or Schedule. Approve never posts.
- Platforms in this build: `instagram`, `facebook`, `threads` only.
- Accounts: @becoming_denis, @attune, @thesolutiontape. The Solution gets no shot list and no daily posts.
- Schedule times are entered in Asia/Dubai (UTC+04:00, no daylight saving).
- Instagram: needs at least one image; carousel max 10; caption max 2200; 25 posts per 24 hours per account.
- Threads: text max 500 characters; carousel max 20.
- A carousel over a platform's slide limit is refused for that platform with the limit shown, never cut.
- Tokens only in Supabase Vault, read only by `service_role`, never sent to the browser.
- Every new SQL function: `revoke execute ... from public, anon, authenticated; grant execute ... to service_role;` (revoking only anon/authenticated does nothing while PUBLIC holds execute).
- No new foreign key between two tables that already have one (`drafts.photo_path` is a plain text column; `posts.source_id` is a plain uuid).
- A failure path carries Meta's response message, never only a status code.
- A test that writes to Supabase writes to PRODUCTION: capture ids and delete them in `afterAll`.
- Never run `npm run seed`.
- Migrations are applied to project `kaniwythbumchzokzyas` with the Supabase MCP `apply_migration` tool, then `npx vitest run tests/db.test.ts`.
- Copy shown to Denis uses no dashes (hyphen, en dash, em dash) as punctuation.
- End every commit message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0007_posting.sql` | Tables, Vault and claim functions, `photos` bucket, extensions |
| `supabase/migrations/0008_publish_cron.sql` | `set_publish_cron` function that stores the route secret and schedules the job |
| `src/posting/types.ts` | `Platform`, `AccountRow`, `PostRow`, `Http`, `Publisher` types |
| `src/posting/rules.ts` | Pure: what can go where, caption limits, Dubai time, schedule and Instagram quota checks |
| `src/posting/graph.ts` | `GraphError`, `graphHttp` (the real `Http`), `GRAPH_VERSION` |
| `src/posting/facebook.ts` | Facebook Page publisher |
| `src/posting/instagram.ts` | Instagram publisher with container status wait |
| `src/posting/threads.ts` | Threads publisher |
| `src/posting/accounts.ts` | Pure: Meta pages to account rows, Threads refresh decision |
| `src/posting/publish.ts` | `publishDue` engine with injected deps |
| `src/posting/plan.ts` | Pure: Post panel selections to `posts` rows |
| `src/posting/store.ts` | Supabase reads and writes for accounts, tokens, posts, photos, shot lists |
| `src/shotList.ts` | Pure: seven day plan from the rota, `parseShotList` |
| `web/app/api/publish-due/route.ts` | Cron entry point |
| `web/app/accounts/page.tsx` | Accounts page |
| `web/app/accounts/connect/meta/route.ts`, `web/app/accounts/callback/meta/route.ts` | Facebook Login |
| `web/app/accounts/connect/threads/route.ts`, `web/app/accounts/callback/threads/route.ts` | Threads login |
| `web/app/drafts/[id]/PostPanel.tsx`, `web/app/posting/actions.ts` | Post panel and its server actions |
| `web/app/ShotListCard.tsx`, `web/app/photos/actions.ts` | This week's photos card and uploads |
| `docs/meta-app-setup.md` | Step by step Meta app setup for Denis |
| `scripts/set-publish-cron.ts` | One time: store cron secret and schedule job |

---

### Task 1: Database for posting

**Files:**
- Create: `supabase/migrations/0007_posting.sql`
- Modify: `src/types.ts`
- Create: `src/posting/types.ts`
- Test: `tests/postingDb.test.ts`

**Interfaces:**
- Produces: tables `social_accounts`, `posts`, `shot_lists`, `photos`; columns `drafts.photo_path`, `drafts_dryrun.photo_path`; RPCs `set_account_token(p_account uuid, p_token text, p_expires timestamptz)`, `get_account_token(p_account uuid) returns text`, `claim_due_posts(p_limit int) returns setof posts`; bucket `photos`; `TaskKind` gains `"shot_list"`; types in `src/posting/types.ts` below.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0007_posting.sql`:

```sql
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
```

Before applying, check whether `tasks.kind` has a check constraint:

Run (Supabase MCP `execute_sql`): `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.tasks'::regclass and contype = 'c';`
Expected: either no kind constraint (the `drop constraint if exists` line is then harmless), or one named `tasks_kind_check`. If it has a different name, replace `tasks_kind_check` in the migration with that name before applying.

- [ ] **Step 2: Add the types**

In `src/types.ts` change the `TaskKind` line to:

```ts
export type TaskKind = "weekly_angles" | "daily_draft" | "brief" | "wholesale_outreach" | "carousel" | "shot_list";
```

and add to `DraftRow`, after `body: string;`:

```ts
  photo_path?: string | null;
```

Create `src/posting/types.ts`:

```ts
export type Platform = "instagram" | "facebook" | "threads";
export const PLATFORMS: Platform[] = ["instagram", "facebook", "threads"];

export type AccountStatus = "ready" | "not_ready" | "reconnect_needed";

export type AccountRow = {
  id: string;
  platform: Platform;
  handle: string;
  external_id: string;
  status: AccountStatus;
  reason: string | null;
  token_expires_at: string | null;
};

export type PostStatus = "scheduled" | "posting" | "posted" | "failed" | "cancelled";

export type PostRow = {
  id: string;
  source_kind: "draft" | "carousel";
  source_id: string;
  account_id: string;
  platform: Platform;
  caption: string;
  image_paths: string[];
  scheduled_for: string;
  status: PostStatus;
  external_id: string | null;
  permalink: string | null;
  error: string | null;
  attempts: number;
  claimed_at: string | null;
  posted_at: string | null;
  created_at: string;
};

/** A Graph or Threads API call. GET puts params in the query, POST sends them as a form. */
export type Http = (
  url: string,
  opts?: { method?: "GET" | "POST"; params?: Record<string, string> },
) => Promise<Record<string, unknown>>;

export type PublishInput = {
  externalAccountId: string;
  token: string;
  caption: string;
  imageUrls: string[];
};

export type PublishResult = { externalId: string; permalink: string | null };

export type Publisher = (input: PublishInput, http: Http) => Promise<PublishResult>;
```

- [ ] **Step 3: Fix the prompt record so it typechecks**

`TASK_PROMPTS` is `Record<TaskKind, string>`, so it now needs a `shot_list` entry. In `src/prompts.ts` add after the `carousel` entry:

```ts
  shot_list:
    "Plan the photos Denis should take for the coming week. The approved angle " +
    "bank and the seven days with their subjects are below. For each day pick the " +
    "angle from the bank that fits that day's subject and describe one photo Denis " +
    "can take himself: the scene, the framing and the orientation. Only real scenes " +
    "from his own life and work that he can actually photograph. No stock images, no " +
    "staged client moments, no other people's faces. Output only a JSON array with " +
    "exactly one object per day, in the given order, each with the keys date, " +
    "subject, angle and shot, and nothing else.",
```

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Apply the migration**

Apply `0007_posting.sql` with Supabase MCP `apply_migration` (name `0007_posting`, project `kaniwythbumchzokzyas`).
Expected: `{"success":true}`.

- [ ] **Step 5: Write the live DB test**

`tests/postingDb.test.ts`:

```ts
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

const hasCredentials = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase: typeof import("../src/db.js")["supabase"];
const accountIds: string[] = [];

describe.skipIf(!hasCredentials)("posting schema", () => {
  beforeAll(async () => {
    ({ supabase } = await import("../src/db.js"));
    const { data, error } = await supabase.from("social_accounts")
      .insert({ platform: "facebook", handle: "test", external_id: `test_${Date.now()}`, status: "ready" })
      .select().single();
    if (error) throw error;
    accountIds.push(data.id);
  });

  afterAll(async () => {
    for (const id of accountIds) {
      const { data } = await supabase.from("social_accounts").select("token_secret_id").eq("id", id).single();
      await supabase.from("social_accounts").delete().eq("id", id);
      if (data?.token_secret_id) await supabase.schema("vault" as never).from("secrets").delete().eq("id", data.token_secret_id);
    }
  });

  it("stores a token in Vault and reads it back only through the function", async () => {
    const id = accountIds[0]!;
    const { error } = await supabase.rpc("set_account_token", { p_account: id, p_token: "tok_1", p_expires: null });
    expect(error).toBeNull();
    const { data } = await supabase.rpc("get_account_token", { p_account: id });
    expect(data).toBe("tok_1");
    await supabase.rpc("set_account_token", { p_account: id, p_token: "tok_2", p_expires: null });
    expect((await supabase.rpc("get_account_token", { p_account: id })).data).toBe("tok_2");
  });

  it("claims a due post exactly once and leaves future posts alone", async () => {
    const id = accountIds[0]!;
    const source = crypto.randomUUID();
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const { data: rows, error } = await supabase.from("posts").insert([
      { source_kind: "draft", source_id: source, account_id: id, platform: "facebook", caption: "due", scheduled_for: past },
      { source_kind: "draft", source_id: source, account_id: id, platform: "facebook", caption: "later", scheduled_for: future },
    ]).select();
    if (error) throw error;

    const first = await supabase.rpc("claim_due_posts", { p_limit: 50 });
    const mine = (first.data as { id: string; status: string; attempts: number }[]).filter((r) => rows!.some((x) => x.id === r.id));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.status).toBe("posting");
    expect(mine[0]!.attempts).toBe(1);

    const second = await supabase.rpc("claim_due_posts", { p_limit: 50 });
    expect((second.data as { id: string }[]).some((r) => rows!.some((x) => x.id === r.id))).toBe(false);
  });

  it("accepts a shot_list task and a draft photo_path", async () => {
    const { data: agent } = await supabase.from("agents")
      .insert({ key: `test_${Date.now()}`, display_name: "Test", department: "Test", enabled: false })
      .select().single();
    const { data: task, error } = await supabase.from("tasks").insert({ agent_id: agent!.id, kind: "shot_list" }).select().single();
    expect(error).toBeNull();
    const { data: draft, error: dErr } = await supabase.from("drafts")
      .insert({ task_id: task!.id, agent_id: agent!.id, body: "photo body long enough", photo_path: "2026-09-16/a.jpg" })
      .select("photo_path").single();
    expect(dErr).toBeNull();
    expect(draft!.photo_path).toBe("2026-09-16/a.jpg");
    await supabase.from("events").delete().eq("agent_id", agent!.id);
    await supabase.from("agents").delete().eq("id", agent!.id);
  });
});
```

- [ ] **Step 6: Run the live DB tests**

Run: `npx vitest run tests/postingDb.test.ts tests/db.test.ts`
Expected: all pass. If the Vault cleanup line fails because the `vault` schema is not exposed to PostgREST, replace it with nothing and note in the build log that test secrets named `social_token_<id>` accumulate; do not expose `vault` to fix it.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0007_posting.sql src/types.ts src/posting/types.ts src/prompts.ts tests/postingDb.test.ts
git commit -m "feat(posting): schema for accounts, posts, shot lists and photos

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Posting rules

**Files:**
- Create: `src/posting/rules.ts`
- Test: `tests/postingRules.test.ts`

**Interfaces:**
- Consumes: `Platform` from `src/posting/types.ts`.
- Produces:
  - `type ItemKind = "text" | "photo" | "carousel"`
  - `canPostTo(item: { kind: ItemKind; imageCount: number }, platform: Platform): { ok: true } | { ok: false; reason: string }`
  - `CAPTION_LIMITS: Record<Platform, number>`
  - `checkCaption(platform: Platform, caption: string): { ok: true } | { ok: false; reason: string }`
  - `dubaiLocalToUtc(local: string): Date` (input `YYYY-MM-DDTHH:MM`, throws `Error("Pick a date and time")` when malformed)
  - `checkScheduleTime(when: Date, now: Date): { ok: true } | { ok: false; reason: string }`
  - `withinInstagramLimit(existing: Date[], when: Date): boolean`
  - `INSTAGRAM_DAILY_LIMIT = 25`

- [ ] **Step 1: Write the failing tests**

`tests/postingRules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  canPostTo, checkCaption, dubaiLocalToUtc, checkScheduleTime, withinInstagramLimit,
  CAPTION_LIMITS, INSTAGRAM_DAILY_LIMIT,
} from "../src/posting/rules.js";

describe("canPostTo", () => {
  it("refuses a text post on Instagram with the reason", () => {
    expect(canPostTo({ kind: "text", imageCount: 0 }, "instagram")).toEqual({ ok: false, reason: "Instagram needs an image" });
  });
  it("allows a text post on Facebook and Threads", () => {
    expect(canPostTo({ kind: "text", imageCount: 0 }, "facebook")).toEqual({ ok: true });
    expect(canPostTo({ kind: "text", imageCount: 0 }, "threads")).toEqual({ ok: true });
  });
  it("allows a photo post everywhere", () => {
    for (const p of ["instagram", "facebook", "threads"] as const) {
      expect(canPostTo({ kind: "photo", imageCount: 1 }, p)).toEqual({ ok: true });
    }
  });
  it("refuses carousels over each platform's slide limit instead of cutting them", () => {
    expect(canPostTo({ kind: "carousel", imageCount: 11 }, "instagram")).toEqual({ ok: false, reason: "Instagram allows up to 10 slides, this has 11" });
    expect(canPostTo({ kind: "carousel", imageCount: 10 }, "instagram")).toEqual({ ok: true });
    expect(canPostTo({ kind: "carousel", imageCount: 21 }, "threads")).toEqual({ ok: false, reason: "Threads allows up to 20 slides, this has 21" });
    expect(canPostTo({ kind: "carousel", imageCount: 21 }, "facebook")).toEqual({ ok: true });
  });
});

describe("checkCaption", () => {
  it("enforces Threads' 500 character limit", () => {
    expect(checkCaption("threads", "a".repeat(500))).toEqual({ ok: true });
    expect(checkCaption("threads", "a".repeat(501))).toEqual({ ok: false, reason: "Threads allows 500 characters, this has 501" });
  });
  it("uses Instagram's 2200 limit", () => {
    expect(CAPTION_LIMITS.instagram).toBe(2200);
  });
  it("refuses an empty caption", () => {
    expect(checkCaption("facebook", "   ")).toEqual({ ok: false, reason: "Caption is empty" });
  });
});

describe("dubaiLocalToUtc", () => {
  it("reads the time as Dubai time", () => {
    expect(dubaiLocalToUtc("2026-09-18T18:00").toISOString()).toBe("2026-09-18T14:00:00.000Z");
  });
  it("rejects anything that is not a date and time", () => {
    expect(() => dubaiLocalToUtc("tomorrow")).toThrow("Pick a date and time");
  });
});

describe("checkScheduleTime", () => {
  const now = new Date("2026-09-15T12:00:00Z");
  it("allows now and the future", () => {
    expect(checkScheduleTime(new Date("2026-09-15T12:00:30Z"), now)).toEqual({ ok: true });
  });
  it("refuses a time more than a minute in the past", () => {
    expect(checkScheduleTime(new Date("2026-09-15T11:58:00Z"), now)).toEqual({ ok: false, reason: "That time has already passed" });
  });
});

describe("withinInstagramLimit", () => {
  const when = new Date("2026-09-15T12:00:00Z");
  it("allows a 25th post in 24 hours but not a 26th", () => {
    const hourly = (n: number) => Array.from({ length: n }, (_, i) => new Date(when.getTime() - (i + 1) * 3_000_000));
    expect(withinInstagramLimit(hourly(INSTAGRAM_DAILY_LIMIT - 1), when)).toBe(true);
    expect(withinInstagramLimit(hourly(INSTAGRAM_DAILY_LIMIT), when)).toBe(false);
  });
  it("ignores posts more than 24 hours away", () => {
    const old = Array.from({ length: 30 }, () => new Date(when.getTime() - 25 * 3_600_000));
    expect(withinInstagramLimit(old, when)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/postingRules.test.ts`
Expected: FAIL, `Cannot find module '../src/posting/rules.js'`.

- [ ] **Step 3: Implement**

`src/posting/rules.ts`:

```ts
import type { Platform } from "./types.js";

export type ItemKind = "text" | "photo" | "carousel";

const LABEL: Record<Platform, string> = { instagram: "Instagram", facebook: "Facebook", threads: "Threads" };

const SLIDE_LIMITS: Partial<Record<Platform, number>> = { instagram: 10, threads: 20 };

export const CAPTION_LIMITS: Record<Platform, number> = { instagram: 2200, facebook: 63206, threads: 500 };

export const INSTAGRAM_DAILY_LIMIT = 25;

type Check = { ok: true } | { ok: false; reason: string };

/** What a platform can take. Over a slide limit is refused, never silently cut. */
export function canPostTo(item: { kind: ItemKind; imageCount: number }, platform: Platform): Check {
  if (platform === "instagram" && item.imageCount === 0) return { ok: false, reason: "Instagram needs an image" };
  const limit = SLIDE_LIMITS[platform];
  if (item.kind === "carousel" && limit !== undefined && item.imageCount > limit) {
    return { ok: false, reason: `${LABEL[platform]} allows up to ${limit} slides, this has ${item.imageCount}` };
  }
  return { ok: true };
}

export function checkCaption(platform: Platform, caption: string): Check {
  if (!caption.trim()) return { ok: false, reason: "Caption is empty" };
  const limit = CAPTION_LIMITS[platform];
  if (caption.length > limit) {
    return { ok: false, reason: `${LABEL[platform]} allows ${limit} characters, this has ${caption.length}` };
  }
  return { ok: true };
}

/** Dubai is UTC+04:00 all year, so a fixed offset is exact. */
export function dubaiLocalToUtc(local: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error("Pick a date and time");
  const d = new Date(`${local}:00+04:00`);
  if (Number.isNaN(d.getTime())) throw new Error("Pick a date and time");
  return d;
}

export function checkScheduleTime(when: Date, now: Date): Check {
  if (when.getTime() < now.getTime() - 60_000) return { ok: false, reason: "That time has already passed" };
  return { ok: true };
}

/** `existing`: scheduled or posted Instagram times for the same account. */
export function withinInstagramLimit(existing: Date[], when: Date): boolean {
  const day = 24 * 3_600_000;
  const near = existing.filter((t) => Math.abs(t.getTime() - when.getTime()) < day).length;
  return near < INSTAGRAM_DAILY_LIMIT;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/postingRules.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/posting/rules.ts tests/postingRules.test.ts
git commit -m "feat(posting): rules for what can go where, captions and schedule times

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Graph client and the three publishers

**Files:**
- Create: `src/posting/graph.ts`, `src/posting/facebook.ts`, `src/posting/instagram.ts`, `src/posting/threads.ts`
- Test: `tests/publishers.test.ts`

**Interfaces:**
- Consumes: `Http`, `Publisher`, `PublishInput`, `PublishResult` from `src/posting/types.ts`.
- Produces:
  - `GRAPH_VERSION: string`, `GRAPH_BASE = "https://graph.facebook.com/" + GRAPH_VERSION`, `THREADS_BASE = "https://graph.threads.net/v1.0"`
  - `class GraphError extends Error { status: number; code: number | null; isAuth: boolean }`
  - `graphHttp: Http` (real fetch)
  - `publishFacebook: Publisher`, `publishThreads: Publisher`
  - `makeInstagramPublisher(opts?: { sleep?: (ms: number) => Promise<void>; tries?: number }): Publisher`, `publishInstagram: Publisher`

- [ ] **Step 1: Write the failing tests**

`tests/publishers.test.ts` uses a fake `Http` that records calls and replays recorded Meta response shapes.

```ts
import { describe, it, expect } from "vitest";
import type { Http } from "../src/posting/types.js";
import { GraphError, GRAPH_BASE, THREADS_BASE, parseGraphResponse } from "../src/posting/graph.js";
import { publishFacebook } from "../src/posting/facebook.js";
import { makeInstagramPublisher } from "../src/posting/instagram.js";
import { publishThreads } from "../src/posting/threads.js";

type Call = { url: string; method: string; params: Record<string, string> };

function fakeHttp(responses: Record<string, unknown>[]): { http: Http; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...responses];
  const http: Http = async (url, opts = {}) => {
    calls.push({ url, method: opts.method ?? "GET", params: opts.params ?? {} });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected call ${url}`);
    return next as Record<string, unknown>;
  };
  return { http, calls };
}

const base = { externalAccountId: "123", token: "TOKEN", caption: "Hello" };

describe("parseGraphResponse", () => {
  it("turns a Graph error envelope into a GraphError carrying Meta's message", () => {
    const err = (() => {
      try { parseGraphResponse(400, { error: { message: "Invalid parameter", code: 100, type: "OAuthException" } }); }
      catch (e) { return e as GraphError; }
    })()!;
    expect(err).toBeInstanceOf(GraphError);
    expect(err.message).toBe("Invalid parameter");
    expect(err.isAuth).toBe(false);
  });
  it("flags an expired token as an auth error", () => {
    expect(() => parseGraphResponse(400, { error: { message: "Session has expired", code: 190 } }))
      .toThrow(expect.objectContaining({ isAuth: true }));
  });
  it("names the status when there is no message", () => {
    expect(() => parseGraphResponse(502, {})).toThrow("Meta returned 502 with no error message");
  });
  it("passes a good body through", () => {
    expect(parseGraphResponse(200, { id: "1" })).toEqual({ id: "1" });
  });
});

describe("publishFacebook", () => {
  it("posts text to the Page feed and reads the permalink", async () => {
    const { http, calls } = fakeHttp([{ id: "123_9" }, { permalink_url: "https://facebook.com/p/9" }]);
    const r = await publishFacebook({ ...base, imageUrls: [] }, http);
    expect(calls[0]).toEqual({ url: `${GRAPH_BASE}/123/feed`, method: "POST", params: { message: "Hello", access_token: "TOKEN" } });
    expect(r).toEqual({ externalId: "123_9", permalink: "https://facebook.com/p/9" });
  });
  it("posts one photo through /photos", async () => {
    const { http, calls } = fakeHttp([{ id: "p1", post_id: "123_5" }, { permalink_url: "https://facebook.com/p/5" }]);
    const r = await publishFacebook({ ...base, imageUrls: ["https://img/1"] }, http);
    expect(calls[0]!.url).toBe(`${GRAPH_BASE}/123/photos`);
    expect(calls[0]!.params).toEqual({ url: "https://img/1", caption: "Hello", access_token: "TOKEN" });
    expect(r.externalId).toBe("123_5");
  });
  it("posts several photos as unpublished uploads attached to one feed post", async () => {
    const { http, calls } = fakeHttp([{ id: "a" }, { id: "b" }, { id: "123_7" }, { permalink_url: "https://facebook.com/p/7" }]);
    await publishFacebook({ ...base, imageUrls: ["https://img/1", "https://img/2"] }, http);
    expect(calls[0]!.params.published).toBe("false");
    expect(calls[2]!.url).toBe(`${GRAPH_BASE}/123/feed`);
    expect(calls[2]!.params).toEqual({
      message: "Hello", access_token: "TOKEN",
      "attached_media[0]": JSON.stringify({ media_fbid: "a" }),
      "attached_media[1]": JSON.stringify({ media_fbid: "b" }),
    });
  });
});

describe("Instagram publisher", () => {
  const noSleep = async () => {};

  it("publishes a single image after the container finishes", async () => {
    const { http, calls } = fakeHttp([
      { id: "c1" }, { status_code: "IN_PROGRESS" }, { status_code: "FINISHED" },
      { id: "m1" }, { permalink: "https://instagram.com/p/m1" },
    ]);
    const r = await makeInstagramPublisher({ sleep: noSleep })({ ...base, imageUrls: ["https://img/1"] }, http);
    expect(calls[0]).toEqual({ url: `${GRAPH_BASE}/123/media`, method: "POST", params: { image_url: "https://img/1", caption: "Hello", access_token: "TOKEN" } });
    expect(calls[3]).toEqual({ url: `${GRAPH_BASE}/123/media_publish`, method: "POST", params: { creation_id: "c1", access_token: "TOKEN" } });
    expect(r).toEqual({ externalId: "m1", permalink: "https://instagram.com/p/m1" });
  });

  it("builds a carousel from child containers", async () => {
    const { http, calls } = fakeHttp([
      { id: "k1" }, { id: "k2" }, { id: "parent" }, { status_code: "FINISHED" }, { id: "m2" }, { permalink: "https://instagram.com/p/m2" },
    ]);
    await makeInstagramPublisher({ sleep: noSleep })({ ...base, imageUrls: ["https://img/1", "https://img/2"] }, http);
    expect(calls[0]!.params).toEqual({ image_url: "https://img/1", is_carousel_item: "true", access_token: "TOKEN" });
    expect(calls[2]!.params).toEqual({ media_type: "CAROUSEL", children: "k1,k2", caption: "Hello", access_token: "TOKEN" });
  });

  it("fails with Meta's status when the container errors", async () => {
    const { http } = fakeHttp([{ id: "c1" }, { status_code: "ERROR", status: "Image could not be downloaded" }]);
    await expect(makeInstagramPublisher({ sleep: noSleep })({ ...base, imageUrls: ["https://img/1"] }, http))
      .rejects.toThrow("Instagram could not process the media: Image could not be downloaded");
  });

  it("gives up after the configured tries", async () => {
    const { http } = fakeHttp([{ id: "c1" }, { status_code: "IN_PROGRESS" }, { status_code: "IN_PROGRESS" }]);
    await expect(makeInstagramPublisher({ sleep: noSleep, tries: 2 })({ ...base, imageUrls: ["https://img/1"] }, http))
      .rejects.toThrow("Instagram was still processing the media after 2 checks");
  });

  it("refuses to publish with no image", async () => {
    const { http } = fakeHttp([]);
    await expect(makeInstagramPublisher({ sleep: noSleep })({ ...base, imageUrls: [] }, http)).rejects.toThrow("Instagram needs an image");
  });
});

describe("publishThreads", () => {
  it("publishes a text post", async () => {
    const { http, calls } = fakeHttp([{ id: "c1" }, { id: "t1" }, { permalink: "https://threads.net/t/1" }]);
    const r = await publishThreads({ ...base, imageUrls: [] }, http);
    expect(calls[0]).toEqual({ url: `${THREADS_BASE}/123/threads`, method: "POST", params: { media_type: "TEXT", text: "Hello", access_token: "TOKEN" } });
    expect(calls[1]).toEqual({ url: `${THREADS_BASE}/123/threads_publish`, method: "POST", params: { creation_id: "c1", access_token: "TOKEN" } });
    expect(r).toEqual({ externalId: "t1", permalink: "https://threads.net/t/1" });
  });
  it("publishes one image", async () => {
    const { http, calls } = fakeHttp([{ id: "c1" }, { id: "t1" }, { permalink: null }]);
    await publishThreads({ ...base, imageUrls: ["https://img/1"] }, http);
    expect(calls[0]!.params).toEqual({ media_type: "IMAGE", image_url: "https://img/1", text: "Hello", access_token: "TOKEN" });
  });
  it("publishes a carousel", async () => {
    const { http, calls } = fakeHttp([{ id: "k1" }, { id: "k2" }, { id: "parent" }, { id: "t2" }, { permalink: "https://threads.net/t/2" }]);
    await publishThreads({ ...base, imageUrls: ["https://img/1", "https://img/2"] }, http);
    expect(calls[0]!.params).toEqual({ media_type: "IMAGE", image_url: "https://img/1", is_carousel_item: "true", access_token: "TOKEN" });
    expect(calls[2]!.params).toEqual({ media_type: "CAROUSEL", children: "k1,k2", text: "Hello", access_token: "TOKEN" });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/publishers.test.ts`
Expected: FAIL, `Cannot find module '../src/posting/graph.js'`.

- [ ] **Step 3: Implement the client**

`src/posting/graph.ts`:

```ts
import type { Http } from "./types.js";

/** Confirm against the app dashboard's API version during Task 5 setup. */
export const GRAPH_VERSION = "v23.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const THREADS_BASE = "https://graph.threads.net/v1.0";

export class GraphError extends Error {
  constructor(message: string, readonly status: number, readonly code: number | null, readonly isAuth: boolean) {
    super(message);
    this.name = "GraphError";
  }
}

/** Meta's own message always travels with the failure. Code 190 is an invalid or expired token. */
export function parseGraphResponse(status: number, body: unknown): Record<string, unknown> {
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const err = obj.error as { message?: string; code?: number; type?: string } | undefined;
  if (err || status >= 400) {
    const code = typeof err?.code === "number" ? err.code : null;
    const message = err?.message ?? `Meta returned ${status} with no error message`;
    throw new GraphError(message, status, code, code === 190);
  }
  return obj;
}

export const graphHttp: Http = async (url, opts = {}) => {
  const method = opts.method ?? "GET";
  const params = new URLSearchParams(opts.params ?? {});
  const res = method === "GET"
    ? await fetch(`${url}?${params}`)
    : await fetch(url, { method: "POST", body: params });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { error: { message: `Meta returned non JSON (${res.status}): ${text.slice(0, 300)}` } }; }
  return parseGraphResponse(res.status, body);
};
```

- [ ] **Step 4: Implement the publishers**

`src/posting/facebook.ts`:

```ts
import { GRAPH_BASE } from "./graph.js";
import type { Publisher } from "./types.js";

export const publishFacebook: Publisher = async ({ externalAccountId: page, token, caption, imageUrls }, http) => {
  let postId: string;
  if (imageUrls.length === 0) {
    const r = await http(`${GRAPH_BASE}/${page}/feed`, { method: "POST", params: { message: caption, access_token: token } });
    postId = String(r.id);
  } else if (imageUrls.length === 1) {
    const r = await http(`${GRAPH_BASE}/${page}/photos`, { method: "POST", params: { url: imageUrls[0]!, caption, access_token: token } });
    postId = String(r.post_id ?? r.id);
  } else {
    const ids: string[] = [];
    for (const url of imageUrls) {
      const r = await http(`${GRAPH_BASE}/${page}/photos`, { method: "POST", params: { url, published: "false", access_token: token } });
      ids.push(String(r.id));
    }
    const params: Record<string, string> = { message: caption, access_token: token };
    ids.forEach((id, i) => { params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
    const r = await http(`${GRAPH_BASE}/${page}/feed`, { method: "POST", params });
    postId = String(r.id);
  }
  const link = await http(`${GRAPH_BASE}/${postId}`, { params: { fields: "permalink_url", access_token: token } });
  return { externalId: postId, permalink: (link.permalink_url as string | undefined) ?? null };
};
```

`src/posting/instagram.ts`:

```ts
import { GRAPH_BASE } from "./graph.js";
import type { Http, Publisher } from "./types.js";

async function waitFinished(http: Http, id: string, token: string, sleep: (ms: number) => Promise<void>, tries: number) {
  for (let i = 0; i < tries; i++) {
    const r = await http(`${GRAPH_BASE}/${id}`, { params: { fields: "status_code,status", access_token: token } });
    if (r.status_code === "FINISHED") return;
    if (r.status_code === "ERROR" || r.status_code === "EXPIRED") {
      throw new Error(`Instagram could not process the media: ${String(r.status ?? r.status_code)}`);
    }
    await sleep(3000);
  }
  throw new Error(`Instagram was still processing the media after ${tries} checks`);
}

export function makeInstagramPublisher(
  opts: { sleep?: (ms: number) => Promise<void>; tries?: number } = {},
): Publisher {
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const tries = opts.tries ?? 20;
  return async ({ externalAccountId: ig, token, caption, imageUrls }, http) => {
    if (imageUrls.length === 0) throw new Error("Instagram needs an image");
    let container: string;
    if (imageUrls.length === 1) {
      const r = await http(`${GRAPH_BASE}/${ig}/media`, { method: "POST", params: { image_url: imageUrls[0]!, caption, access_token: token } });
      container = String(r.id);
    } else {
      const children: string[] = [];
      for (const url of imageUrls) {
        const r = await http(`${GRAPH_BASE}/${ig}/media`, { method: "POST", params: { image_url: url, is_carousel_item: "true", access_token: token } });
        children.push(String(r.id));
      }
      const r = await http(`${GRAPH_BASE}/${ig}/media`, {
        method: "POST", params: { media_type: "CAROUSEL", children: children.join(","), caption, access_token: token },
      });
      container = String(r.id);
    }
    await waitFinished(http, container, token, sleep, tries);
    const published = await http(`${GRAPH_BASE}/${ig}/media_publish`, { method: "POST", params: { creation_id: container, access_token: token } });
    const mediaId = String(published.id);
    const link = await http(`${GRAPH_BASE}/${mediaId}`, { params: { fields: "permalink", access_token: token } });
    return { externalId: mediaId, permalink: (link.permalink as string | undefined) ?? null };
  };
}

export const publishInstagram = makeInstagramPublisher();
```

`src/posting/threads.ts`:

```ts
import { THREADS_BASE } from "./graph.js";
import type { Publisher } from "./types.js";

export const publishThreads: Publisher = async ({ externalAccountId: user, token, caption, imageUrls }, http) => {
  let container: string;
  if (imageUrls.length === 0) {
    const r = await http(`${THREADS_BASE}/${user}/threads`, { method: "POST", params: { media_type: "TEXT", text: caption, access_token: token } });
    container = String(r.id);
  } else if (imageUrls.length === 1) {
    const r = await http(`${THREADS_BASE}/${user}/threads`, {
      method: "POST", params: { media_type: "IMAGE", image_url: imageUrls[0]!, text: caption, access_token: token },
    });
    container = String(r.id);
  } else {
    const children: string[] = [];
    for (const url of imageUrls) {
      const r = await http(`${THREADS_BASE}/${user}/threads`, {
        method: "POST", params: { media_type: "IMAGE", image_url: url, is_carousel_item: "true", access_token: token },
      });
      children.push(String(r.id));
    }
    const r = await http(`${THREADS_BASE}/${user}/threads`, {
      method: "POST", params: { media_type: "CAROUSEL", children: children.join(","), text: caption, access_token: token },
    });
    container = String(r.id);
  }
  const published = await http(`${THREADS_BASE}/${user}/threads_publish`, { method: "POST", params: { creation_id: container, access_token: token } });
  const id = String(published.id);
  const link = await http(`${THREADS_BASE}/${id}`, { params: { fields: "permalink", access_token: token } });
  return { externalId: id, permalink: (link.permalink as string | null | undefined) ?? null };
};
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run tests/publishers.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add src/posting/graph.ts src/posting/facebook.ts src/posting/instagram.ts src/posting/threads.ts tests/publishers.test.ts
git commit -m "feat(posting): Graph client and Facebook, Instagram and Threads publishers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Store and the publishDue engine

**Files:**
- Create: `src/posting/store.ts`, `src/posting/publish.ts`
- Test: `tests/publishDue.test.ts`

**Interfaces:**
- Consumes: types from Task 1; `Publisher`, `GraphError` from Task 3; `supabase` from `src/db.js`.
- Produces:
  - `store.ts`: `listAccounts(): Promise<AccountRow[]>`, `getAccount(id: string): Promise<AccountRow | null>`, `upsertAccount(a: { platform: Platform; handle: string; external_id: string; status: AccountStatus; reason: string | null }): Promise<string>` (returns id), `setAccountToken(id: string, token: string, expiresAt: Date | null): Promise<void>`, `getAccountToken(id: string): Promise<string | null>`, `markAccountReconnect(id: string, reason: string): Promise<void>`, `claimDuePosts(limit: number): Promise<PostRow[]>`, `failStuckPosts(now: Date): Promise<number>`, `markPostPosted(id: string, r: PublishResult): Promise<void>`, `markPostFailed(id: string, error: string): Promise<void>`, `insertPosts(rows: NewPost[]): Promise<void>`, `postsForSource(kind: "draft" | "carousel", id: string): Promise<PostRow[]>`, `cancelPost(id: string): Promise<boolean>`, `retryPost(id: string): Promise<boolean>`, `instagramTimes(accountId: string): Promise<Date[]>`, `signPostImages(paths: string[]): Promise<string[]>`, `photoForDay(day: string): Promise<string | null>`, `upsertPhoto(day: string, path: string): Promise<void>`, `createPhotoUploadUrl(path: string): Promise<string>`, `signPhoto(path: string): Promise<string>`, `insertShotList(taskId: string, weekStart: string, entries: unknown[]): Promise<void>`, `latestShotList(): Promise<{ week_start: string; entries: ShotEntry[] } | null>`, `photosForDays(days: string[]): Promise<Record<string, string>>`, `queueShotListTask(): Promise<void>`, `setDraftPhoto(draftId: string, path: string | null): Promise<void>`
  - `type NewPost = Pick<PostRow, "source_kind" | "source_id" | "account_id" | "platform" | "caption" | "image_paths" | "scheduled_for">`
  - `publish.ts`: `type PublishDeps`, `publishDue(deps: PublishDeps, now: Date): Promise<{ claimed: number; posted: number; failed: number; stuck: number }>`, `STUCK_AFTER_MS = 15 * 60_000`
  - `ShotEntry` is imported from `src/shotList.ts` (Task 8). In this task, declare it locally in `store.ts` as `export type ShotEntry = { date: string; subject: string; angle: string; shot: string };` and Task 8 re-exports it from `src/shotList.ts` via `export type { ShotEntry } from "./posting/store.js";`

- [ ] **Step 1: Write the failing engine tests**

`tests/publishDue.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { publishDue, type PublishDeps } from "../src/posting/publish.js";
import { GraphError } from "../src/posting/graph.js";
import type { AccountRow, PostRow } from "../src/posting/types.js";

const post = (over: Partial<PostRow> = {}): PostRow => ({
  id: "p1", source_kind: "draft", source_id: "d1", account_id: "a1", platform: "facebook",
  caption: "Hello", image_paths: ["2026-09-16/x.jpg"], scheduled_for: "2026-09-15T12:00:00Z",
  status: "posting", external_id: null, permalink: null, error: null, attempts: 1,
  claimed_at: "2026-09-15T12:00:00Z", posted_at: null, created_at: "2026-09-15T11:00:00Z", ...over,
});
const account: AccountRow = { id: "a1", platform: "facebook", handle: "attune", external_id: "123", status: "ready", reason: null, token_expires_at: null };

const deps = (over: Partial<PublishDeps> = {}): PublishDeps => ({
  failStuck: vi.fn(async () => 0),
  claimDue: vi.fn(async () => [post()]),
  getAccount: vi.fn(async () => account),
  getToken: vi.fn(async () => "TOKEN"),
  signImages: vi.fn(async (paths: string[]) => paths.map((p) => `https://signed/${p}`)),
  markPosted: vi.fn(async () => {}),
  markFailed: vi.fn(async () => {}),
  markAccountReconnect: vi.fn(async () => {}),
  publishers: {
    facebook: vi.fn(async () => ({ externalId: "123_1", permalink: "https://fb/1" })),
    instagram: vi.fn(async () => ({ externalId: "m", permalink: null })),
    threads: vi.fn(async () => ({ externalId: "t", permalink: null })),
  },
  http: vi.fn(),
  ...over,
});

const now = new Date("2026-09-15T12:00:30Z");

describe("publishDue", () => {
  it("publishes a claimed post with signed images and records the result", async () => {
    const d = deps();
    expect(await publishDue(d, now)).toEqual({ claimed: 1, posted: 1, failed: 0, stuck: 0 });
    expect(d.publishers.facebook).toHaveBeenCalledWith(
      { externalAccountId: "123", token: "TOKEN", caption: "Hello", imageUrls: ["https://signed/2026-09-16/x.jpg"] }, d.http,
    );
    expect(d.markPosted).toHaveBeenCalledWith("p1", { externalId: "123_1", permalink: "https://fb/1" });
  });

  it("fails stuck posts first and reports them", async () => {
    const d = deps({ failStuck: vi.fn(async () => 2), claimDue: vi.fn(async () => []) });
    expect(await publishDue(d, now)).toEqual({ claimed: 0, posted: 0, failed: 0, stuck: 2 });
    expect(d.failStuck).toHaveBeenCalledWith(now);
  });

  it("fails with Meta's message and keeps going to the next post", async () => {
    const d = deps({
      claimDue: vi.fn(async () => [post(), post({ id: "p2" })]),
      publishers: {
        ...deps().publishers,
        facebook: vi.fn()
          .mockRejectedValueOnce(new GraphError("Invalid parameter", 400, 100, false))
          .mockResolvedValueOnce({ externalId: "123_2", permalink: null }),
      },
    });
    expect(await publishDue(d, now)).toEqual({ claimed: 2, posted: 1, failed: 1, stuck: 0 });
    expect(d.markFailed).toHaveBeenCalledWith("p1", "Invalid parameter");
  });

  it("marks the account for reconnection on an auth error", async () => {
    const d = deps({
      publishers: { ...deps().publishers, facebook: vi.fn(async () => { throw new GraphError("Session has expired", 400, 190, true); }) },
    });
    await publishDue(d, now);
    expect(d.markAccountReconnect).toHaveBeenCalledWith("a1", "Session has expired");
    expect(d.markFailed).toHaveBeenCalledWith("p1", "Reconnect needed: Session has expired");
  });

  it("does not call Meta for an account that is not ready", async () => {
    const d = deps({ getAccount: vi.fn(async () => ({ ...account, status: "reconnect_needed" as const, reason: "token expired" })) });
    await publishDue(d, now);
    expect(d.publishers.facebook).not.toHaveBeenCalled();
    expect(d.markFailed).toHaveBeenCalledWith("p1", "Account not ready: token expired");
  });

  it("fails a post whose token is missing", async () => {
    const d = deps({ getToken: vi.fn(async () => null) });
    await publishDue(d, now);
    expect(d.markFailed).toHaveBeenCalledWith("p1", "No token stored for this account. Reconnect it.");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/publishDue.test.ts`
Expected: FAIL, `Cannot find module '../src/posting/publish.js'`.

- [ ] **Step 3: Implement the engine**

`src/posting/publish.ts`:

```ts
import { GraphError } from "./graph.js";
import type { AccountRow, Http, Platform, PostRow, Publisher, PublishResult } from "./types.js";

export const STUCK_AFTER_MS = 15 * 60_000;

export type PublishDeps = {
  failStuck: (now: Date) => Promise<number>;
  claimDue: (limit: number) => Promise<PostRow[]>;
  getAccount: (id: string) => Promise<AccountRow | null>;
  getToken: (accountId: string) => Promise<string | null>;
  signImages: (paths: string[]) => Promise<string[]>;
  markPosted: (id: string, r: PublishResult) => Promise<void>;
  markFailed: (id: string, error: string) => Promise<void>;
  markAccountReconnect: (accountId: string, reason: string) => Promise<void>;
  publishers: Record<Platform, Publisher>;
  http: Http;
};

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * One cron tick. Stuck rows are failed first and never retried automatically,
 * because Meta may already have posted them. Each claimed row is handled on
 * its own so one failure never blocks the rest.
 */
export async function publishDue(deps: PublishDeps, now: Date) {
  const stuck = await deps.failStuck(now);
  const rows = await deps.claimDue(10);
  let posted = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const account = await deps.getAccount(row.account_id);
      if (!account || account.status !== "ready") {
        await deps.markFailed(row.id, `Account not ready: ${account?.reason ?? "account missing"}`);
        failed++;
        continue;
      }
      const token = await deps.getToken(account.id);
      if (!token) {
        await deps.markFailed(row.id, "No token stored for this account. Reconnect it.");
        failed++;
        continue;
      }
      const imageUrls = row.image_paths.length ? await deps.signImages(row.image_paths) : [];
      const result = await deps.publishers[row.platform](
        { externalAccountId: account.external_id, token, caption: row.caption, imageUrls }, deps.http,
      );
      await deps.markPosted(row.id, result);
      posted++;
    } catch (err) {
      failed++;
      const message = messageOf(err);
      if (err instanceof GraphError && err.isAuth) {
        await deps.markAccountReconnect(row.account_id, message);
        await deps.markFailed(row.id, `Reconnect needed: ${message}`);
      } else {
        await deps.markFailed(row.id, message);
      }
    }
  }

  return { claimed: rows.length, posted, failed, stuck };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/publishDue.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Implement the store**

`src/posting/store.ts`:

```ts
import { supabase } from "../db.js";
import { STUCK_AFTER_MS } from "./publish.js";
import type { AccountRow, AccountStatus, Platform, PostRow, PublishResult } from "./types.js";

export type NewPost = Pick<PostRow, "source_kind" | "source_id" | "account_id" | "platform" | "caption" | "image_paths" | "scheduled_for">;
export type ShotEntry = { date: string; subject: string; angle: string; shot: string };

const ACCOUNT_FIELDS = "id, platform, handle, external_id, status, reason, token_expires_at";

function check(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export async function listAccounts(): Promise<AccountRow[]> {
  const { data, error } = await supabase.from("social_accounts").select(ACCOUNT_FIELDS).order("handle");
  check(error, "listAccounts");
  return (data ?? []) as AccountRow[];
}

export async function getAccount(id: string): Promise<AccountRow | null> {
  const { data, error } = await supabase.from("social_accounts").select(ACCOUNT_FIELDS).eq("id", id).maybeSingle();
  check(error, `getAccount(${id})`);
  return (data as AccountRow | null) ?? null;
}

export async function upsertAccount(a: {
  platform: Platform; handle: string; external_id: string; status: AccountStatus; reason: string | null;
}): Promise<string> {
  const { data, error } = await supabase.from("social_accounts")
    .upsert({ ...a, updated_at: new Date().toISOString() }, { onConflict: "platform,external_id" })
    .select("id").single();
  check(error, "upsertAccount");
  return (data as { id: string }).id;
}

export async function setAccountToken(id: string, token: string, expiresAt: Date | null): Promise<void> {
  const { error } = await supabase.rpc("set_account_token", {
    p_account: id, p_token: token, p_expires: expiresAt ? expiresAt.toISOString() : null,
  });
  check(error, "setAccountToken");
}

export async function getAccountToken(id: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_account_token", { p_account: id });
  check(error, "getAccountToken");
  return (data as string | null) ?? null;
}

export async function markAccountReconnect(id: string, reason: string): Promise<void> {
  const { error } = await supabase.from("social_accounts")
    .update({ status: "reconnect_needed", reason, updated_at: new Date().toISOString() }).eq("id", id);
  check(error, "markAccountReconnect");
}

export async function claimDuePosts(limit: number): Promise<PostRow[]> {
  const { data, error } = await supabase.rpc("claim_due_posts", { p_limit: limit });
  check(error, "claimDuePosts");
  return (data ?? []) as PostRow[];
}

export async function failStuckPosts(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS).toISOString();
  const { data, error } = await supabase.from("posts")
    .update({ status: "failed", error: "Publish did not complete. Check the account before retrying, it may have posted." })
    .eq("status", "posting").lt("claimed_at", cutoff).select("id");
  check(error, "failStuckPosts");
  return (data ?? []).length;
}

export async function markPostPosted(id: string, r: PublishResult): Promise<void> {
  const { error } = await supabase.from("posts").update({
    status: "posted", external_id: r.externalId, permalink: r.permalink, error: null, posted_at: new Date().toISOString(),
  }).eq("id", id);
  check(error, "markPostPosted");
}

export async function markPostFailed(id: string, message: string): Promise<void> {
  const { error } = await supabase.from("posts").update({ status: "failed", error: message }).eq("id", id);
  check(error, "markPostFailed");
}

export async function insertPosts(rows: NewPost[]): Promise<void> {
  const { error } = await supabase.from("posts").insert(rows);
  check(error, "insertPosts");
}

export async function postsForSource(kind: "draft" | "carousel", id: string): Promise<PostRow[]> {
  const { data, error } = await supabase.from("posts").select("*")
    .eq("source_kind", kind).eq("source_id", id).order("scheduled_for");
  check(error, "postsForSource");
  return (data ?? []) as PostRow[];
}

/** Only a row still waiting can be cancelled. Returns whether it was. */
export async function cancelPost(id: string): Promise<boolean> {
  const { data, error } = await supabase.from("posts").update({ status: "cancelled" })
    .eq("id", id).eq("status", "scheduled").select("id");
  check(error, "cancelPost");
  return (data ?? []).length === 1;
}

/** A failed row goes back in the queue for the next tick. Returns whether it did. */
export async function retryPost(id: string): Promise<boolean> {
  const { data, error } = await supabase.from("posts")
    .update({ status: "scheduled", error: null, scheduled_for: new Date().toISOString() })
    .eq("id", id).eq("status", "failed").select("id");
  check(error, "retryPost");
  return (data ?? []).length === 1;
}

export async function instagramTimes(accountId: string): Promise<Date[]> {
  const { data, error } = await supabase.from("posts").select("scheduled_for, posted_at")
    .eq("account_id", accountId).eq("platform", "instagram").in("status", ["scheduled", "posting", "posted"]);
  check(error, "instagramTimes");
  return (data ?? []).map((r) => new Date((r.posted_at ?? r.scheduled_for) as string));
}

/** Post images live in two buckets: carousel slides and uploaded photos. The path prefix says which. */
export async function signPostImages(paths: string[]): Promise<string[]> {
  const urls: string[] = [];
  for (const p of paths) {
    const [bucket, ...rest] = p.split(":");
    const { data, error } = await supabase.storage.from(rest.length ? bucket! : "carousels")
      .createSignedUrl(rest.length ? rest.join(":") : p, 3600);
    check(error, `signPostImages(${p})`);
    urls.push(data!.signedUrl);
  }
  return urls;
}

export async function photoForDay(day: string): Promise<string | null> {
  const { data, error } = await supabase.from("photos").select("path").eq("day", day).maybeSingle();
  check(error, "photoForDay");
  return (data?.path as string | undefined) ?? null;
}

export async function photosForDays(days: string[]): Promise<Record<string, string>> {
  if (days.length === 0) return {};
  const { data, error } = await supabase.from("photos").select("day, path").in("day", days);
  check(error, "photosForDays");
  return Object.fromEntries((data ?? []).map((r) => [r.day as string, r.path as string]));
}

export async function upsertPhoto(day: string, path: string): Promise<void> {
  const { error } = await supabase.from("photos").upsert({ day, path }, { onConflict: "day" });
  check(error, "upsertPhoto");
}

export async function createPhotoUploadUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("photos").createSignedUploadUrl(path, { upsert: true });
  if (error || !data) throw new Error(`createPhotoUploadUrl(${path}): ${error?.message ?? "no data"}`);
  return data.signedUrl;
}

export async function signPhoto(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("photos").createSignedUrl(path, 3600);
  if (error || !data) throw new Error(`signPhoto(${path}): ${error?.message ?? "no data"}`);
  return data.signedUrl;
}

export async function insertShotList(taskId: string, weekStart: string, entries: unknown[]): Promise<void> {
  const { error } = await supabase.from("shot_lists").insert({ task_id: taskId, week_start: weekStart, entries });
  check(error, "insertShotList");
}

export async function latestShotList(): Promise<{ week_start: string; entries: ShotEntry[] } | null> {
  const { data, error } = await supabase.from("shot_lists").select("week_start, entries")
    .order("created_at", { ascending: false }).limit(1);
  check(error, "latestShotList");
  return (data?.[0] as { week_start: string; entries: ShotEntry[] } | undefined) ?? null;
}

/** Queues the Strategist's shot list unless one is already on its way. */
export async function queueShotListTask(): Promise<void> {
  const { data: agent, error: aErr } = await supabase.from("agents").select("id").eq("key", "strategist").single();
  check(aErr, "queueShotListTask agent");
  const { count, error: cErr } = await supabase.from("tasks").select("id", { count: "exact", head: true })
    .eq("kind", "shot_list").in("state", ["queued", "running"]);
  check(cErr, "queueShotListTask count");
  if ((count ?? 0) > 0) return;
  const { error } = await supabase.from("tasks").insert({ agent_id: (agent as { id: string }).id, kind: "shot_list" });
  check(error, "queueShotListTask insert");
}

export async function setDraftPhoto(draftId: string, path: string | null): Promise<void> {
  const { error } = await supabase.from("drafts").update({ photo_path: path }).eq("id", draftId);
  check(error, "setDraftPhoto");
}
```

Image path convention used everywhere from here on: a carousel slide path is stored as-is (`<carouselId>/01-hook.png`, bucket `carousels`); a photo path is stored as `photos:<day>/<file>`. `signPostImages` reads the prefix.

- [ ] **Step 6: Typecheck and run all unit tests**

Run: `npm run typecheck && npx vitest run --exclude tests/db.test.ts --exclude tests/postingDb.test.ts`
Expected: no type errors, all pass.

- [ ] **Step 7: Commit**

```bash
git add src/posting/publish.ts src/posting/store.ts tests/publishDue.test.ts
git commit -m "feat(posting): publishDue engine and posting store

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Meta app setup, account connection and the Accounts page

**Files:**
- Create: `docs/meta-app-setup.md`, `src/posting/accounts.ts`, `web/app/accounts/page.tsx`, `web/app/accounts/connect/meta/route.ts`, `web/app/accounts/callback/meta/route.ts`, `web/app/accounts/connect/threads/route.ts`, `web/app/accounts/callback/threads/route.ts`, `web/app/accounts/oauth.ts`
- Modify: `web/app/Sidebar.tsx` (add Accounts link), `web/app/BottomNav.tsx` (add Accounts link)
- Test: `tests/accounts.test.ts`

**Interfaces:**
- Consumes: `store.ts` account functions, `graphHttp`, `GRAPH_BASE`, `GRAPH_VERSION`, `THREADS_BASE`.
- Produces:
  - `pagesToAccounts(pages: MetaPage[]): { account: { platform: Platform; handle: string; external_id: string; status: AccountStatus; reason: string | null }; token: string }[]`
  - `type MetaPage = { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }`
  - `needsThreadsRefresh(expiresAt: string | null, now: Date): boolean`
  - `THREADS_REFRESH_WINDOW_MS = 7 * 86_400_000`
  - Env vars (Vercel, Production): `META_APP_ID`, `META_APP_SECRET`, `THREADS_APP_ID`, `THREADS_APP_SECRET`, `PUBLIC_BASE_URL=https://agentco-golosindenis-projects.vercel.app`

- [ ] **Step 1: Write the setup guide for Denis**

`docs/meta-app-setup.md`:

```markdown
# Meta app setup for agentco posting

Do this once. It creates the app agentco uses to post to your own accounts.
The app stays in development mode: you are its admin, it posts only to your
accounts, and Meta does not need to review it.

## 1. Check each Instagram account

For @becoming_denis, @attune and @thesolutiontape, in the Instagram app:
Settings, Account type and tools. It must say Professional (Creator or
Business). Then Settings, Accounts Centre: each must be connected to a
Facebook Page you manage. Note any that are not.

## 2. Create the app

1. Go to developers.facebook.com, My Apps, Create app.
2. Use case: "Other", then type "Business". Name it "agentco".
3. In the app dashboard, add the products **Facebook Login for Business**
   and **Instagram Graph API** (Instagram with Facebook Login).
4. Add the use case **Access the Threads API**.
5. Note the Graph API version shown at the top of the dashboard.

## 3. Redirect addresses

- Facebook Login for Business, Settings, Valid OAuth Redirect URIs:
  `https://agentco-golosindenis-projects.vercel.app/accounts/callback/meta`
- Threads API, Settings, Redirect Callback URLs:
  `https://agentco-golosindenis-projects.vercel.app/accounts/callback/threads`
  Also fill Uninstall and Delete callback URLs with the same address.

## 4. Permissions

- Facebook Login: `pages_show_list`, `pages_manage_posts`,
  `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`,
  `business_management`.
- Threads: `threads_basic`, `threads_content_publish`.
- Threads, Roles: add your Threads account as a Threads Tester, then accept
  the invite in the Threads app (Settings, Account, Website permissions,
  Invites). Repeat for each Threads account you want to connect.

## 5. Give Claude the keys

App settings, Basic: App ID and App secret. Threads API settings: Threads
App ID and Threads App secret. Paste them only into the terminal prompts
Claude gives you, never into chat.
```

- [ ] **Step 2: Denis completes the setup (human step)**

Stop and ask Denis to follow `docs/meta-app-setup.md` sections 1 to 4, and to report which Instagram accounts are not Professional or not linked to a Page, and the Graph API version shown. If the version differs from `v23.0`, update `GRAPH_VERSION` in `src/posting/graph.ts` and rerun `npx vitest run tests/publishers.test.ts`.

Then have Denis run, from `~/agentco`, one command per secret (each prompts without echoing):

```bash
read -rs META_APP_ID && printf %s "$META_APP_ID" | npx vercel env add META_APP_ID production
```

```bash
read -rs META_APP_SECRET && printf %s "$META_APP_SECRET" | npx vercel env add META_APP_SECRET production
```

```bash
read -rs THREADS_APP_ID && printf %s "$THREADS_APP_ID" | npx vercel env add THREADS_APP_ID production
```

```bash
read -rs THREADS_APP_SECRET && printf %s "$THREADS_APP_SECRET" | npx vercel env add THREADS_APP_SECRET production
```

```bash
printf %s "https://agentco-golosindenis-projects.vercel.app" | npx vercel env add PUBLIC_BASE_URL production
```

Expected: each prints `Added Environment Variable`.

- [ ] **Step 3: Write the failing tests for the pure account mapping**

`tests/accounts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pagesToAccounts, needsThreadsRefresh } from "../src/posting/accounts.js";

describe("pagesToAccounts", () => {
  it("makes a ready Facebook account and a ready Instagram account from a linked Page", () => {
    const out = pagesToAccounts([
      { id: "p1", name: "Attune", access_token: "PT", instagram_business_account: { id: "ig1", username: "attune" } },
    ]);
    expect(out).toEqual([
      { account: { platform: "facebook", handle: "Attune", external_id: "p1", status: "ready", reason: null }, token: "PT" },
      { account: { platform: "instagram", handle: "@attune", external_id: "ig1", status: "ready", reason: null }, token: "PT" },
    ]);
  });

  it("explains a Page with no Instagram as not ready for Instagram", () => {
    const out = pagesToAccounts([{ id: "p2", name: "The Solution", access_token: "PT2" }]);
    expect(out[1]).toEqual({
      account: {
        platform: "instagram", handle: "The Solution (no Instagram)", external_id: "page:p2", status: "not_ready",
        reason: "No Instagram account is linked to this Page, or it is a personal account. Switch it to Creator or Business and link it to the Page.",
      },
      token: "PT2",
    });
  });
});

describe("needsThreadsRefresh", () => {
  const now = new Date("2026-09-15T00:00:00Z");
  it("refreshes inside seven days of expiry", () => {
    expect(needsThreadsRefresh("2026-09-21T00:00:00Z", now)).toBe(true);
  });
  it("leaves a fresh token alone", () => {
    expect(needsThreadsRefresh("2026-11-01T00:00:00Z", now)).toBe(false);
  });
  it("does nothing without an expiry", () => {
    expect(needsThreadsRefresh(null, now)).toBe(false);
  });
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `npx vitest run tests/accounts.test.ts`
Expected: FAIL, `Cannot find module '../src/posting/accounts.js'`.

- [ ] **Step 5: Implement**

`src/posting/accounts.ts`:

```ts
import type { AccountStatus, Platform } from "./types.js";

export type MetaPage = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
};

type Mapped = {
  account: { platform: Platform; handle: string; external_id: string; status: AccountStatus; reason: string | null };
  token: string;
};

export const THREADS_REFRESH_WINDOW_MS = 7 * 86_400_000;

/** A Page token posts for both the Page and its linked Instagram account. */
export function pagesToAccounts(pages: MetaPage[]): Mapped[] {
  const out: Mapped[] = [];
  for (const page of pages) {
    out.push({ account: { platform: "facebook", handle: page.name, external_id: page.id, status: "ready", reason: null }, token: page.access_token });
    const ig = page.instagram_business_account;
    out.push(ig
      ? { account: { platform: "instagram", handle: `@${ig.username ?? ig.id}`, external_id: ig.id, status: "ready", reason: null }, token: page.access_token }
      : {
        account: {
          platform: "instagram", handle: `${page.name} (no Instagram)`, external_id: `page:${page.id}`, status: "not_ready",
          reason: "No Instagram account is linked to this Page, or it is a personal account. Switch it to Creator or Business and link it to the Page.",
        },
        token: page.access_token,
      });
  }
  return out;
}

export function needsThreadsRefresh(expiresAt: string | null, now: Date): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - now.getTime() < THREADS_REFRESH_WINDOW_MS;
}
```

- [ ] **Step 6: Run to verify they pass**

Run: `npx vitest run tests/accounts.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Add the OAuth helper and routes**

`web/app/accounts/oauth.ts`:

```ts
import "server-only";
import { cookies } from "next/headers";
import { randomBytes, timingSafeEqual } from "node:crypto";

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function redirectUri(provider: "meta" | "threads"): string {
  return `${env("PUBLIC_BASE_URL")}/accounts/callback/${provider}`;
}

/** A random state kept in an httpOnly cookie, so a callback we did not start is refused. */
export async function newState(provider: string): Promise<string> {
  const state = randomBytes(24).toString("hex");
  (await cookies()).set(`oauth_${provider}`, state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/accounts" });
  return state;
}

export async function stateMatches(provider: string, got: string | null): Promise<boolean> {
  const store = await cookies();
  const want = store.get(`oauth_${provider}`)?.value;
  store.delete(`oauth_${provider}`);
  if (!want || !got || want.length !== got.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(got));
}
```

`web/app/accounts/connect/meta/route.ts`:

```ts
import { NextResponse } from "next/server";
import { GRAPH_VERSION } from "../../../../../src/posting/graph.js";
import { currentUser } from "../../../lib/supabaseServer";
import { env, newState, redirectUri } from "../../oauth";

const SCOPES = ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "instagram_basic", "instagram_content_publish", "business_management"];

export async function GET() {
  if (!(await currentUser())) return new NextResponse("Not authorized", { status: 401 });
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", env("META_APP_ID"));
  url.searchParams.set("redirect_uri", redirectUri("meta"));
  url.searchParams.set("state", await newState("meta"));
  url.searchParams.set("scope", SCOPES.join(","));
  return NextResponse.redirect(url);
}
```

`web/app/accounts/callback/meta/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { GRAPH_BASE, graphHttp } from "../../../../../src/posting/graph.js";
import { pagesToAccounts, type MetaPage } from "../../../../../src/posting/accounts.js";
import { setAccountToken, upsertAccount } from "../../../../../src/posting/store.js";
import { currentUser } from "../../../lib/supabaseServer";
import { env, redirectUri, stateMatches } from "../../oauth";

function back(req: NextRequest, message: string) {
  const url = new URL("/accounts", req.url);
  url.searchParams.set("msg", message);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  if (!(await currentUser())) return new NextResponse("Not authorized", { status: 401 });
  const q = req.nextUrl.searchParams;
  if (!(await stateMatches("meta", q.get("state")))) return back(req, "Meta connection refused: state did not match. Try again.");
  if (q.get("error")) return back(req, `Meta connection cancelled: ${q.get("error_description") ?? q.get("error")}`);
  try {
    const short = await graphHttp(`${GRAPH_BASE}/oauth/access_token`, {
      params: { client_id: env("META_APP_ID"), client_secret: env("META_APP_SECRET"), redirect_uri: redirectUri("meta"), code: q.get("code") ?? "" },
    });
    const long = await graphHttp(`${GRAPH_BASE}/oauth/access_token`, {
      params: { grant_type: "fb_exchange_token", client_id: env("META_APP_ID"), client_secret: env("META_APP_SECRET"), fb_exchange_token: String(short.access_token) },
    });
    // Page tokens fetched with a long lived user token do not expire.
    const pages = await graphHttp(`${GRAPH_BASE}/me/accounts`, {
      params: { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100", access_token: String(long.access_token) },
    });
    const mapped = pagesToAccounts((pages.data ?? []) as MetaPage[]);
    for (const m of mapped) {
      const id = await upsertAccount(m.account);
      await setAccountToken(id, m.token, null);
    }
    return back(req, `Connected ${mapped.filter((m) => m.account.status === "ready").length} Meta accounts.`);
  } catch (err) {
    return back(req, `Meta connection failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

`web/app/accounts/connect/threads/route.ts`:

```ts
import { NextResponse } from "next/server";
import { currentUser } from "../../../lib/supabaseServer";
import { env, newState, redirectUri } from "../../oauth";

export async function GET() {
  if (!(await currentUser())) return new NextResponse("Not authorized", { status: 401 });
  const url = new URL("https://threads.net/oauth/authorize");
  url.searchParams.set("client_id", env("THREADS_APP_ID"));
  url.searchParams.set("redirect_uri", redirectUri("threads"));
  url.searchParams.set("scope", "threads_basic,threads_content_publish");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", await newState("threads"));
  return NextResponse.redirect(url);
}
```

`web/app/accounts/callback/threads/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { THREADS_BASE, graphHttp } from "../../../../../src/posting/graph.js";
import { setAccountToken, upsertAccount } from "../../../../../src/posting/store.js";
import { currentUser } from "../../../lib/supabaseServer";
import { env, redirectUri, stateMatches } from "../../oauth";

function back(req: NextRequest, message: string) {
  const url = new URL("/accounts", req.url);
  url.searchParams.set("msg", message);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  if (!(await currentUser())) return new NextResponse("Not authorized", { status: 401 });
  const q = req.nextUrl.searchParams;
  if (!(await stateMatches("threads", q.get("state")))) return back(req, "Threads connection refused: state did not match. Try again.");
  if (q.get("error")) return back(req, `Threads connection cancelled: ${q.get("error_description") ?? q.get("error")}`);
  try {
    const short = await graphHttp("https://graph.threads.net/oauth/access_token", {
      method: "POST",
      params: {
        client_id: env("THREADS_APP_ID"), client_secret: env("THREADS_APP_SECRET"),
        grant_type: "authorization_code", redirect_uri: redirectUri("threads"), code: q.get("code") ?? "",
      },
    });
    const long = await graphHttp("https://graph.threads.net/access_token", {
      params: { grant_type: "th_exchange_token", client_secret: env("THREADS_APP_SECRET"), access_token: String(short.access_token) },
    });
    const token = String(long.access_token);
    const me = await graphHttp(`${THREADS_BASE}/me`, { params: { fields: "id,username", access_token: token } });
    const id = await upsertAccount({ platform: "threads", handle: `@${String(me.username)}`, external_id: String(me.id), status: "ready", reason: null });
    await setAccountToken(id, token, new Date(Date.now() + Number(long.expires_in ?? 5_184_000) * 1000));
    return back(req, `Connected Threads @${String(me.username)}.`);
  } catch (err) {
    return back(req, `Threads connection failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

- [ ] **Step 8: Add the Accounts page**

`web/app/accounts/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { listAccounts } from "../../../src/posting/store.js";
import { currentUser } from "../lib/supabaseServer";

export const dynamic = "force-dynamic";

const LABEL = { instagram: "Instagram", facebook: "Facebook", threads: "Threads" } as const;
const STATUS = { ready: "Ready", not_ready: "Not ready", reconnect_needed: "Reconnect needed" } as const;

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  if (!(await currentUser())) redirect("/login");
  const { msg } = await searchParams;
  const accounts = await listAccounts();

  return (
    <main className="wrap">
      <Link href="/" className="back">Back</Link>
      <h1>Accounts</h1>
      {msg && <p className="note-band">{msg}</p>}
      <p className="hint">Posting only happens when you tick an account and press Post now or Schedule.</p>
      <div className="action-row">
        <a className="primary" href="/accounts/connect/meta">Connect Meta (Facebook and Instagram)</a>
        <a className="primary" href="/accounts/connect/threads">Connect Threads</a>
      </div>
      {accounts.length === 0 && <p className="empty">No accounts connected yet.</p>}
      <ul className="feed">
        {accounts.map((a) => (
          <li key={a.id} className="feed-row">
            <strong>{LABEL[a.platform]}</strong> {a.handle} · {STATUS[a.status]}
            {a.reason && <div className="hint">{a.reason}</div>}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

In `web/app/Sidebar.tsx` and `web/app/BottomNav.tsx`, add a link to `/accounts` labelled `Accounts`, copying the markup and `active` handling of the existing `/org` link in each file exactly.

- [ ] **Step 9: Build and commit**

Run: `npm run typecheck && npm run web:build`
Expected: no type errors; `Compiled successfully`.

```bash
git add docs/meta-app-setup.md src/posting/accounts.ts tests/accounts.test.ts web/app/accounts web/app/Sidebar.tsx web/app/BottomNav.tsx src/posting/graph.ts
git commit -m "feat(posting): connect Meta and Threads accounts, Accounts page, setup guide

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Cron route, schedule and Threads token refresh

**Files:**
- Create: `web/app/api/publish-due/route.ts`, `supabase/migrations/0008_publish_cron.sql`, `scripts/set-publish-cron.ts`
- Modify: `web/middleware.ts` (matcher)
- Test: `tests/cronAuth.test.ts`, `web/app/api/publish-due/cronAuth.ts`

**Interfaces:**
- Consumes: `publishDue`, store functions, publishers, `graphHttp`, `needsThreadsRefresh`, `listAccounts`, `getAccountToken`, `setAccountToken`.
- Produces: `POST /api/publish-due` with header `x-cron-secret`; RPC `set_publish_cron(p_url text, p_secret text)`; env `CRON_SECRET`; `cronSecretMatches(header: string | null, secret: string | undefined): boolean`.

- [ ] **Step 1: Write the failing test for the secret check**

`tests/cronAuth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cronSecretMatches } from "../web/app/api/publish-due/cronAuth.js";

describe("cronSecretMatches", () => {
  it("accepts the exact secret", () => {
    expect(cronSecretMatches("abc123", "abc123")).toBe(true);
  });
  it("refuses a wrong, missing or unconfigured secret", () => {
    expect(cronSecretMatches("abc124", "abc123")).toBe(false);
    expect(cronSecretMatches(null, "abc123")).toBe(false);
    expect(cronSecretMatches("abc123", undefined)).toBe(false);
    expect(cronSecretMatches("", "")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/cronAuth.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement the check and the route**

`web/app/api/publish-due/cronAuth.ts`:

```ts
import { timingSafeEqual } from "node:crypto";

export function cronSecretMatches(header: string | null, secret: string | undefined): boolean {
  if (!header || !secret) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

`web/app/api/publish-due/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { publishDue } from "../../../../src/posting/publish.js";
import { graphHttp } from "../../../../src/posting/graph.js";
import { publishFacebook } from "../../../../src/posting/facebook.js";
import { publishInstagram } from "../../../../src/posting/instagram.js";
import { publishThreads } from "../../../../src/posting/threads.js";
import { needsThreadsRefresh } from "../../../../src/posting/accounts.js";
import {
  claimDuePosts, failStuckPosts, getAccount, getAccountToken, listAccounts, markAccountReconnect,
  markPostFailed, markPostPosted, setAccountToken, signPostImages,
} from "../../../../src/posting/store.js";
import { cronSecretMatches } from "./cronAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function refreshThreadsTokens(now: Date): Promise<string[]> {
  const problems: string[] = [];
  for (const a of await listAccounts()) {
    if (a.platform !== "threads" || a.status !== "ready" || !needsThreadsRefresh(a.token_expires_at, now)) continue;
    try {
      const token = await getAccountToken(a.id);
      if (!token) continue;
      const r = await graphHttp("https://graph.threads.net/refresh_access_token", { params: { grant_type: "th_refresh_token", access_token: token } });
      await setAccountToken(a.id, String(r.access_token), new Date(now.getTime() + Number(r.expires_in ?? 5_184_000) * 1000));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markAccountReconnect(a.id, `Threads token refresh failed: ${message}`);
      problems.push(`${a.handle}: ${message}`);
    }
  }
  return problems;
}

export async function POST(req: NextRequest) {
  if (!cronSecretMatches(req.headers.get("x-cron-secret"), process.env.CRON_SECRET)) {
    return new NextResponse("Not authorized", { status: 401 });
  }
  const now = new Date();
  const result = await publishDue({
    failStuck: failStuckPosts,
    claimDue: claimDuePosts,
    getAccount,
    getToken: getAccountToken,
    signImages: signPostImages,
    markPosted: markPostPosted,
    markFailed: markPostFailed,
    markAccountReconnect,
    publishers: { facebook: publishFacebook, instagram: publishInstagram, threads: publishThreads },
    http: graphHttp,
  }, now);
  const refreshProblems = await refreshThreadsTokens(now);
  return NextResponse.json({ ...result, refreshProblems });
}
```

- [ ] **Step 4: Let the cron reach the route without a session**

In `web/middleware.ts`, change the matcher string to exclude `api/publish-due` the same anchored way:

```ts
    "/((?!login(?:/|$)|auth/callback(?:/|$)|api/publish-due(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$|manifest\\.webmanifest$|icons/).*)",
```

and add a line to the comment above it: `// api/publish-due is called by pg_cron with no session; it checks x-cron-secret itself.`

- [ ] **Step 5: Run tests and build**

Run: `npx vitest run tests/cronAuth.test.ts && npm run typecheck && npm run web:build`
Expected: PASS, no type errors, `Compiled successfully`.

- [ ] **Step 6: The cron function**

`supabase/migrations/0008_publish_cron.sql`:

```sql
-- Stores the publish route address and secret in Vault and schedules the
-- every minute call. Called once from scripts/set-publish-cron.ts so the
-- secret never appears in a migration.
create or replace function set_publish_cron(p_url text, p_secret text)
returns void
language plpgsql
security definer
set search_path = public, vault, cron
as $$
begin
  delete from vault.secrets where name in ('publish_due_url', 'publish_due_secret');
  perform vault.create_secret(p_url, 'publish_due_url');
  perform vault.create_secret(p_secret, 'publish_due_secret');
  perform cron.unschedule(jobid) from cron.job where jobname = 'publish-due';
  perform cron.schedule('publish-due', '* * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'publish_due_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'publish_due_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
  $job$);
end;
$$;

revoke execute on function set_publish_cron(text, text) from public, anon, authenticated;
grant execute on function set_publish_cron(text, text) to service_role;
```

Apply with Supabase MCP `apply_migration` (name `0008_publish_cron`).
Expected: `{"success":true}`.

`scripts/set-publish-cron.ts`:

```ts
import { supabase } from "../src/db.js";

const secret = process.env.CRON_SECRET;
if (!secret) throw new Error("CRON_SECRET must be set for this command");
const url = "https://agentco-golosindenis-projects.vercel.app/api/publish-due";
const { error } = await supabase.rpc("set_publish_cron", { p_url: url, p_secret: secret });
if (error) throw new Error(`set_publish_cron: ${error.message}`);
console.log(`publish-due scheduled every minute against ${url}`);
```

- [ ] **Step 7: Commit, deploy, set the secret and schedule**

```bash
git add web/app/api/publish-due tests/cronAuth.test.ts web/middleware.ts supabase/migrations/0008_publish_cron.sql scripts/set-publish-cron.ts
git commit -m "feat(posting): every minute publish route called by pg_cron

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```

Generate one secret and put it in both places in a single shell, so it is never printed:

```bash
cd ~/agentco && CRON_SECRET=$(openssl rand -hex 32) && printf %s "$CRON_SECRET" | npx vercel env add CRON_SECRET production && npx vercel deploy --prod && CRON_SECRET="$CRON_SECRET" node --env-file=.env --import tsx scripts/set-publish-cron.ts
```

Expected: `Added Environment Variable`, a Ready production deployment, then `publish-due scheduled every minute against https://agentco-golosindenis-projects.vercel.app/api/publish-due`.

- [ ] **Step 8: Verify the cron reaches the route**

Wait two minutes, then run (Supabase MCP `execute_sql`):
`select status_code, content from net._http_response order by created desc limit 3;`
Expected: `200` with content like `{"claimed":0,"posted":0,"failed":0,"stuck":0,"refreshProblems":[]}`.

And confirm the route refuses strangers:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://agentco-golosindenis-projects.vercel.app/api/publish-due
```

Expected: `401`.

---

### Task 7: Post panel

**Files:**
- Create: `src/posting/plan.ts`, `web/app/posting/actions.ts`, `web/app/drafts/[id]/PostPanel.tsx`
- Modify: `web/app/drafts/[id]/page.tsx`
- Test: `tests/postPlan.test.ts`

**Interfaces:**
- Consumes: rules from Task 2, `NewPost`, `insertPosts`, `postsForSource`, `cancelPost`, `retryPost`, `instagramTimes`, `listAccounts` from Task 4.
- Produces:
  - `type PostSource = { kind: "draft" | "carousel"; id: string; itemKind: ItemKind; imagePaths: string[] }`
  - `type Selection = { accountId: string; platform: Platform; caption: string }`
  - `planPosts(source: PostSource, selections: Selection[], when: Date, now: Date, instagramExisting: Record<string, Date[]>): { ok: true; rows: NewPost[] } | { ok: false; errors: string[] }`
  - Server actions: `schedulePosts(input: { source: PostSource; selections: Selection[]; local: string | null }): Promise<{ ok: true } | { ok: false; error: string }>` (`local` null means now), `cancelScheduledPost(id: string)`, `retryFailedPost(id: string)` with the same result type.

- [ ] **Step 1: Write the failing tests**

`tests/postPlan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planPosts, type PostSource } from "../src/posting/plan.js";

const now = new Date("2026-09-15T12:00:00Z");
const text: PostSource = { kind: "draft", id: "d1", itemKind: "text", imagePaths: [] };
const photo: PostSource = { kind: "draft", id: "d1", itemKind: "photo", imagePaths: ["photos:2026-09-15/a.jpg"] };

describe("planPosts", () => {
  it("makes one row per ticked account at the chosen time", () => {
    const r = planPosts(photo, [
      { accountId: "fb", platform: "facebook", caption: "Hi" },
      { accountId: "ig", platform: "instagram", caption: "Hi ig" },
    ], now, now, {});
    expect(r).toEqual({
      ok: true,
      rows: [
        { source_kind: "draft", source_id: "d1", account_id: "fb", platform: "facebook", caption: "Hi", image_paths: ["photos:2026-09-15/a.jpg"], scheduled_for: now.toISOString() },
        { source_kind: "draft", source_id: "d1", account_id: "ig", platform: "instagram", caption: "Hi ig", image_paths: ["photos:2026-09-15/a.jpg"], scheduled_for: now.toISOString() },
      ],
    });
  });

  it("collects every problem instead of stopping at the first", () => {
    const r = planPosts(text, [
      { accountId: "ig", platform: "instagram", caption: "Hi" },
      { accountId: "th", platform: "threads", caption: "x".repeat(501) },
    ], now, now, {});
    expect(r).toEqual({ ok: false, errors: ["Instagram: Instagram needs an image", "Threads: Threads allows 500 characters, this has 501"] });
  });

  it("refuses an empty selection and a past time", () => {
    expect(planPosts(text, [], now, now, {})).toEqual({ ok: false, errors: ["Tick at least one account"] });
    expect(planPosts(text, [{ accountId: "fb", platform: "facebook", caption: "Hi" }], new Date("2026-09-15T11:00:00Z"), now, {}))
      .toEqual({ ok: false, errors: ["That time has already passed"] });
  });

  it("refuses an Instagram account already at 25 posts that day", () => {
    const busy = Array.from({ length: 25 }, (_, i) => new Date(now.getTime() + i * 60_000));
    expect(planPosts(photo, [{ accountId: "ig", platform: "instagram", caption: "Hi" }], now, now, { ig: busy }))
      .toEqual({ ok: false, errors: ["Instagram: this account already has 25 posts within 24 hours of that time"] });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/postPlan.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

`src/posting/plan.ts`:

```ts
import { canPostTo, checkCaption, checkScheduleTime, withinInstagramLimit, type ItemKind } from "./rules.js";
import type { NewPost } from "./store.js";
import type { Platform } from "./types.js";

export type PostSource = { kind: "draft" | "carousel"; id: string; itemKind: ItemKind; imagePaths: string[] };
export type Selection = { accountId: string; platform: Platform; caption: string };

const LABEL: Record<Platform, string> = { instagram: "Instagram", facebook: "Facebook", threads: "Threads" };

export function planPosts(
  source: PostSource, selections: Selection[], when: Date, now: Date, instagramExisting: Record<string, Date[]>,
): { ok: true; rows: NewPost[] } | { ok: false; errors: string[] } {
  if (selections.length === 0) return { ok: false, errors: ["Tick at least one account"] };
  const time = checkScheduleTime(when, now);
  if (!time.ok) return { ok: false, errors: [time.reason] };

  const errors: string[] = [];
  for (const s of selections) {
    const fit = canPostTo({ kind: source.itemKind, imageCount: source.imagePaths.length }, s.platform);
    if (!fit.ok) errors.push(`${LABEL[s.platform]}: ${fit.reason}`);
    const cap = checkCaption(s.platform, s.caption);
    if (!cap.ok) errors.push(`${LABEL[s.platform]}: ${cap.reason}`);
    if (s.platform === "instagram" && !withinInstagramLimit(instagramExisting[s.accountId] ?? [], when)) {
      errors.push("Instagram: this account already has 25 posts within 24 hours of that time");
    }
  }
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    rows: selections.map((s) => ({
      source_kind: source.kind, source_id: source.id, account_id: s.accountId, platform: s.platform,
      caption: s.caption, image_paths: source.imagePaths, scheduled_for: when.toISOString(),
    })),
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/postPlan.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Server actions**

`web/app/posting/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { planPosts, type PostSource, type Selection } from "../../../src/posting/plan.js";
import { dubaiLocalToUtc } from "../../../src/posting/rules.js";
import { cancelPost, insertPosts, instagramTimes, retryPost } from "../../../src/posting/store.js";
import { currentUser } from "../lib/supabaseServer";

export type PostingResult = { ok: true } | { ok: false; error: string };

export async function schedulePosts(input: { source: PostSource; selections: Selection[]; local: string | null; draftId: string }): Promise<PostingResult> {
  try {
    if (!(await currentUser())) return { ok: false, error: "Not authorized." };
    const now = new Date();
    const when = input.local ? dubaiLocalToUtc(input.local) : now;
    const existing: Record<string, Date[]> = {};
    for (const s of input.selections) {
      if (s.platform === "instagram") existing[s.accountId] = await instagramTimes(s.accountId);
    }
    const plan = planPosts(input.source, input.selections, when, now, existing);
    if (!plan.ok) return { ok: false, error: plan.errors.join(". ") };
    await insertPosts(plan.rows);
    revalidatePath(`/drafts/${input.draftId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function cancelScheduledPost(id: string, draftId: string): Promise<PostingResult> {
  if (!(await currentUser())) return { ok: false, error: "Not authorized." };
  const done = await cancelPost(id);
  revalidatePath(`/drafts/${draftId}`);
  return done ? { ok: true } : { ok: false, error: "It already started posting or was cancelled." };
}

export async function retryFailedPost(id: string, draftId: string): Promise<PostingResult> {
  if (!(await currentUser())) return { ok: false, error: "Not authorized." };
  const done = await retryPost(id);
  revalidatePath(`/drafts/${draftId}`);
  return done ? { ok: true } : { ok: false, error: "Only a failed post can be retried." };
}
```

- [ ] **Step 6: The panel**

`web/app/drafts/[id]/PostPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { canPostTo, type ItemKind } from "../../../../src/posting/rules.js";
import type { AccountRow, Platform, PostRow } from "../../../../src/posting/types.js";
import type { PostSource } from "../../../../src/posting/plan.js";
import { cancelScheduledPost, retryFailedPost, schedulePosts } from "../../posting/actions";

const LABEL: Record<Platform, string> = { instagram: "Instagram", facebook: "Facebook", threads: "Threads" };

function fmtDubai(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dubai", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function PostPanel({ draftId, sources, accounts, posts, defaultCaption }: {
  draftId: string;
  sources: { label: string; source: PostSource }[];
  accounts: AccountRow[];
  posts: PostRow[];
  defaultCaption: string;
}) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [local, setLocal] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const source = sources[sourceIndex]?.source;
  if (!source) return null;

  async function submit(now: boolean) {
    setBusy(true);
    setMessage("");
    const selections = accounts.filter((a) => ticked[a.id]).map((a) => ({ accountId: a.id, platform: a.platform, caption: captions[a.id] ?? defaultCaption }));
    const r = await schedulePosts({ source: source!, selections, local: now ? null : local, draftId });
    setBusy(false);
    if (r.ok) { setTicked({}); setMessage(now ? "Posting now. It appears below within a minute." : "Scheduled."); }
    else setMessage(r.error);
  }

  return (
    <section className="note-band">
      <h2>Post</h2>
      {sources.length > 1 && (
        <div className="action-row">
          {sources.map((s, i) => (
            <label key={s.label}><input type="radio" checked={i === sourceIndex} onChange={() => setSourceIndex(i)} /> {s.label}</label>
          ))}
        </div>
      )}
      {accounts.length === 0 && <p className="hint">No accounts connected. <a href="/accounts">Connect accounts</a></p>}
      {accounts.map((a) => {
        const fit = canPostTo({ kind: source.itemKind as ItemKind, imageCount: source.imagePaths.length }, a.platform);
        const usable = a.status === "ready" && fit.ok;
        const why = a.status !== "ready" ? (a.reason ?? "Not ready") : fit.ok ? null : fit.reason;
        return (
          <div key={a.id} className="angle-pick">
            <label>
              <input type="checkbox" disabled={!usable} checked={!!ticked[a.id]} onChange={(e) => setTicked({ ...ticked, [a.id]: e.target.checked })} />
              <span>{a.handle} · {LABEL[a.platform]}</span>
            </label>
            {why && <div className="hint">{why}</div>}
            {ticked[a.id] && (
              <textarea rows={4} value={captions[a.id] ?? defaultCaption} onChange={(e) => setCaptions({ ...captions, [a.id]: e.target.value })} />
            )}
          </div>
        );
      })}
      <div className="action-row">
        <button type="button" className="primary" disabled={busy} onClick={() => submit(true)}>Post now</button>
        <input type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} aria-label="Schedule time, Dubai" />
        <button type="button" disabled={busy || !local} onClick={() => submit(false)}>Schedule (Dubai time)</button>
      </div>
      {message && <p className="hint">{message}</p>}

      {posts.length > 0 && (
        <ul className="feed">
          {posts.map((p) => {
            const account = accounts.find((a) => a.id === p.account_id);
            const who = `${account?.handle ?? "account"} · ${LABEL[p.platform]}`;
            return (
              <li key={p.id} className="feed-row">
                {who}:{" "}
                {p.status === "scheduled" && <>scheduled for {fmtDubai(p.scheduled_for)} <button type="button" onClick={() => cancelScheduledPost(p.id, draftId)}>Cancel</button></>}
                {p.status === "posting" && <>posting…</>}
                {p.status === "posted" && <>posted {p.permalink && <a href={p.permalink} target="_blank" rel="noopener">view</a>}</>}
                {p.status === "failed" && <>failed: {p.error} <button type="button" onClick={() => retryFailedPost(p.id, draftId)}>Retry</button></>}
                {p.status === "cancelled" && <>cancelled</>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 7: Show it on the draft page**

In `web/app/drafts/[id]/page.tsx`:

Add imports:

```ts
import { PostPanel } from "./PostPanel";
import { listAccounts, postsForSource } from "../../../../src/posting/store.js";
import type { PostSource } from "../../../../src/posting/plan.js";
```

After the `const [images, downloads] = ...` block add:

```ts
  const canPost = draft.status === "approved" && draft.kind === "daily_draft";
  const sources: { label: string; source: PostSource }[] = [];
  if (canPost) {
    const photo = (draft as { photo_path?: string | null }).photo_path ?? null;
    sources.push({
      label: photo ? "Post with photo" : "Text post",
      source: { kind: "draft", id: draft.id, itemKind: photo ? "photo" : "text", imagePaths: photo ? [`photos:${photo}`] : [] },
    });
    if (carousel?.lastSent?.image_paths?.length) {
      sources.push({
        label: `Sent carousel, ${carousel.lastSent.image_paths.length} slides`,
        source: { kind: "carousel", id: carousel.lastSent.id, itemKind: "carousel", imagePaths: carousel.lastSent.image_paths },
      });
    }
  }
  const [accounts, draftPosts, carouselPosts] = canPost
    ? await Promise.all([
      listAccounts(),
      postsForSource("draft", draft.id),
      carousel?.lastSent ? postsForSource("carousel", carousel.lastSent.id) : Promise.resolve([]),
    ])
    : [[], [], []];
```

Inside the non-pending branch, after the `CarouselPanel` block, add:

```tsx
          {canPost && (
            <PostPanel
              draftId={draft.id}
              sources={sources}
              accounts={accounts}
              posts={[...draftPosts, ...carouselPosts]}
              defaultCaption={draft.body}
            />
          )}
```

In `src/db.ts` `getDraftForReview`, add `photo_path` to the select string (`"id, body, status, created_at, agent_id, photo_path, agents(display_name, level), tasks(kind)"`), add `photo_path: string | null;` to the return type, and `photo_path: row.photo_path ?? null,` to the returned object. Then drop the cast in the page: `const photo = draft.photo_path;`.

- [ ] **Step 8: Build, test, commit**

Run: `npm run typecheck && npx vitest run --exclude tests/db.test.ts --exclude tests/postingDb.test.ts && npm run web:build`
Expected: no type errors, all pass, `Compiled successfully`.

```bash
git add src/posting/plan.ts tests/postPlan.test.ts web/app/posting/actions.ts "web/app/drafts/[id]/PostPanel.tsx" "web/app/drafts/[id]/page.tsx" src/db.ts
git commit -m "feat(posting): Post panel with post now, schedule, cancel and retry

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Deploy and prove Post now on one account**

```bash
git push origin main
```

Wait for the Vercel production deploy to be Ready (`npx vercel ls agentco`). Then ask Denis to open an approved daily post on production, tick **one** ready Facebook Page, and press Post now. Within two minutes the row must show `posted` with a working view link. If it shows `failed`, the error is Meta's message: fix the cause before Task 8.

---

### Task 8: Shot list

**Files:**
- Create: `src/shotList.ts`
- Modify: `src/worker.ts`, `web/app/actions.ts`, `tests/worker.test.ts`
- Test: `tests/shotList.test.ts`

**Interfaces:**
- Consumes: `subjectFor`, `SUBJECTS`, `SubjectKey` from `src/subjects.ts`; `TASK_PROMPTS.shot_list`; `insertShotList`, `queueShotListTask`, `ShotEntry` from `src/posting/store.ts`.
- Produces:
  - `localDay(d: Date): string` (`YYYY-MM-DD` in the machine's local time)
  - `weekPlan(start: Date): { date: string; subject: SubjectKey }[]` (seven days starting at `start`)
  - `parseShotList(body: string, plan: { date: string; subject: SubjectKey }[]): { ok: true; entries: ShotEntry[] } | { ok: false; reason: string }`
  - `WorkerDeps` gains `insertShotList: (taskId: string, weekStart: string, entries: ShotEntry[]) => Promise<void>`

- [ ] **Step 1: Write the failing tests**

`tests/shotList.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { localDay, weekPlan, parseShotList } from "../src/shotList.js";

describe("weekPlan", () => {
  it("gives seven consecutive days with the rota's subject", () => {
    const plan = weekPlan(new Date(2026, 8, 16)); // Wed 16 Sep 2026, local
    expect(plan).toHaveLength(7);
    expect(plan[0]).toEqual({ date: "2026-09-16", subject: "agentco" });
    expect(plan[1]).toEqual({ date: "2026-09-17", subject: "attune" });
    expect(plan[6]).toEqual({ date: "2026-09-22", subject: "denis" });
  });
});

describe("localDay", () => {
  it("formats the local calendar day", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});

describe("parseShotList", () => {
  const plan = weekPlan(new Date(2026, 8, 16));
  const good = plan.map((d) => ({ date: d.date, subject: d.subject, angle: "An angle", shot: "Desk at night, horizontal" }));

  it("accepts seven entries matching the plan", () => {
    expect(parseShotList(JSON.stringify(good), plan)).toEqual({ ok: true, entries: good });
  });
  it("accepts JSON inside a code fence", () => {
    expect(parseShotList("```json\n" + JSON.stringify(good) + "\n```", plan).ok).toBe(true);
  });
  it("rejects anything that is not JSON", () => {
    expect(parseShotList("Here is your list", plan)).toEqual({ ok: false, reason: "shot list is not valid JSON" });
  });
  it("rejects the wrong number of days", () => {
    expect(parseShotList(JSON.stringify(good.slice(0, 6)), plan)).toEqual({ ok: false, reason: "shot list has 6 days, expected 7" });
  });
  it("rejects a day out of order or with the wrong subject", () => {
    const bad = good.map((e, i) => (i === 2 ? { ...e, subject: "agentco" } : e));
    expect(parseShotList(JSON.stringify(bad), plan)).toEqual({ ok: false, reason: `day 3 should be ${plan[2]!.date} ${plan[2]!.subject}` });
  });
  it("rejects an empty shot", () => {
    const bad = good.map((e, i) => (i === 0 ? { ...e, shot: " " } : e));
    expect(parseShotList(JSON.stringify(bad), plan)).toEqual({ ok: false, reason: "day 1 has no angle or shot" });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/shotList.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

`src/shotList.ts`:

```ts
import { subjectFor, type SubjectKey } from "./subjects.js";
import type { ShotEntry } from "./posting/store.js";

export type { ShotEntry } from "./posting/store.js";

export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The Mac worker runs in Dubai local time, the same clock the rota uses. */
export function weekPlan(start: Date): { date: string; subject: SubjectKey }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { date: localDay(d), subject: subjectFor(d) };
  });
}

export function parseShotList(
  body: string, plan: { date: string; subject: SubjectKey }[],
): { ok: true; entries: ShotEntry[] } | { ok: false; reason: string } {
  const unfenced = body.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try { parsed = JSON.parse(unfenced); } catch { return { ok: false, reason: "shot list is not valid JSON" }; }
  if (!Array.isArray(parsed)) return { ok: false, reason: "shot list is not a JSON array" };
  if (parsed.length !== plan.length) return { ok: false, reason: `shot list has ${parsed.length} days, expected ${plan.length}` };
  const entries: ShotEntry[] = [];
  for (let i = 0; i < plan.length; i++) {
    const e = parsed[i] as Record<string, unknown>;
    const want = plan[i]!;
    if (e?.date !== want.date || e?.subject !== want.subject) return { ok: false, reason: `day ${i + 1} should be ${want.date} ${want.subject}` };
    if (typeof e.angle !== "string" || !e.angle.trim() || typeof e.shot !== "string" || !e.shot.trim()) {
      return { ok: false, reason: `day ${i + 1} has no angle or shot` };
    }
    entries.push({ date: want.date, subject: want.subject, angle: e.angle.trim(), shot: e.shot.trim() });
  }
  return { ok: true, entries };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/shotList.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the failing worker test**

In `tests/worker.test.ts`, add to the `deps` factory after `latestDeclineReason`:

```ts
  insertShotList: vi.fn(async () => {}),
```

and add at the end of the `processOne` describe:

```ts
  it("writes a shot list for the week from the approved bank", async () => {
    const shotTask = { ...task, kind: "shot_list" };
    const { weekPlan } = await import("../src/shotList.js");
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const plan = weekPlan(tomorrow);
    const body = JSON.stringify(plan.map((d) => ({ ...d, angle: "a", shot: "b" })));
    const d = deps({ claimNextTask: vi.fn(async () => shotTask), runAgent: vi.fn(async (): Promise<RunResult> => ({ ok: true, body, usage: defaultUsage })) });
    expect(await processOne(d, false)).toBe("produced");
    const prompt = (d.runAgent as any).mock.calls[0][1] as string;
    expect(prompt).toContain("[Attune] a");
    expect(prompt).toContain(plan[0]!.date);
    expect(d.insertShotList).toHaveBeenCalledWith("t1", plan[0]!.date, plan.map((p) => ({ ...p, angle: "a", shot: "b" })));
    expect(d.insertDraft).not.toHaveBeenCalled();
    expect(d.countPendingDrafts).not.toHaveBeenCalled();
  });

  it("fails a shot list with no approved bank", async () => {
    const d = deps({ claimNextTask: vi.fn(async () => ({ ...task, kind: "shot_list" })), latestApprovedDraftBody: vi.fn(async () => null) });
    expect(await processOne(d, false)).toBe("failed");
    expect(d.runAgent).not.toHaveBeenCalled();
  });
```

Run: `npx vitest run tests/worker.test.ts`
Expected: FAIL (type error or `insertShotList` not called).

- [ ] **Step 6: Implement the worker path**

In `src/worker.ts`:

Add imports:

```ts
import { localDay, parseShotList, weekPlan, type ShotEntry } from "./shotList.js";
```

Add to `WorkerDeps`:

```ts
  insertShotList: (taskId: string, weekStart: string, entries: ShotEntry[]) => Promise<void>;
```

In `buildLiveDeps`, load the store and add the dep:

```ts
  const store = await import("./posting/store.js");
```

```ts
    insertShotList: store.insertShotList,
```

Add this function after `produceCarousel`:

```ts
/**
 * The week's photo briefs, one per day from tomorrow, from the approved bank.
 * Like a carousel it never enters drafts, so no backpressure and no ladder.
 */
async function produceShotList(
  deps: WorkerDeps, task: TaskRow, agent: AgentRow, markWritten: () => void,
): Promise<WorkerOutcome> {
  const fail = async (reason: string, event: string) => {
    await deps.logEvent(event, { reason }, agent.id, task.id);
    await deps.finishTask(task.id, "failed", reason);
    return "failed" as const;
  };
  const bank = await deps.latestApprovedDraftBody("weekly_angles");
  if (bank === null) return fail("no approved weekly_angles draft to plan photos from", "no_angle_bank");

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const plan = weekPlan(tomorrow);
  const prompt =
    `${TASK_PROMPTS.shot_list}\n\n## Days\n\n` +
    plan.map((d) => `${d.date}: ${SUBJECTS[d.subject].label} (${d.subject})`).join("\n") +
    `\n\n## Approved angle bank\n\n${bank}`;

  const run = await deps.runAgent(agent, prompt);
  if (!run.ok) return fail(run.reason, "run_failed");
  const parsed = parseShotList(run.body, plan);
  if (!parsed.ok) return fail(parsed.reason, "output_rejected");

  await deps.insertShotList(task.id, plan[0]!.date, parsed.entries);
  markWritten();
  await deps.logEvent("shot_list_created", { days: parsed.entries.length, costUsd: run.usage.costUsd, model: run.usage.model }, agent.id, task.id);
  await deps.finishTask(task.id, "done");
  return "produced";
}
```

In `processOne`, right after the carousel branch:

```ts
    if (task.kind === "shot_list") {
      return await produceShotList(deps, task, agent, () => { draftWritten = true; });
    }
```

`localDay` is used in Task 9; keep the import.

- [ ] **Step 7: Queue it when the bank is approved**

In `web/app/actions.ts`:

Add import: `import { queueShotListTask } from "../../src/posting/store.js";`

Replace the body of `recordAndRevalidate`'s `try` block with:

```ts
    const draft = await getDraftForReview(draftId);
    if (!draft) return { ok: false, error: "This draft no longer exists." };
    if (draft.status !== "pending") return { ok: false, error: `This draft was already ${draft.status}.` };
    const deps = await buildLiveReviewDeps();
    const result = await recordVerdict(deps, draftId, agentId, verdict, reason, opts);
    // An approved bank is what the week's photos are planned from.
    if (draft.kind === "weekly_angles" && !result.alreadyDecided && verdict !== "declined") {
      await queueShotListTask();
    }
    revalidatePath("/");
    return { ok: true };
```

(The inlined status check is `requirePendingDraft`'s logic; keep `requirePendingDraft` for its other callers.)

- [ ] **Step 8: Run tests, build, commit**

Run: `npm run typecheck && npx vitest run --exclude tests/db.test.ts --exclude tests/postingDb.test.ts && npm run web:build`
Expected: no type errors, all pass, `Compiled successfully`.

```bash
git add src/shotList.ts tests/shotList.test.ts src/worker.ts tests/worker.test.ts web/app/actions.ts
git commit -m "feat(shots): Strategist plans the week's photos when the angle bank is approved

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Photos: upload, attach to the daily post, swap and remove

**Files:**
- Create: `web/app/ShotListCard.tsx`, `web/app/photos/actions.ts`, `src/photoPath.ts`
- Modify: `src/worker.ts`, `src/db.ts` (`insertDraft`), `web/app/TodayView.tsx`, `web/app/OverviewView.tsx`, `web/app/page.tsx`, `web/app/drafts/[id]/page.tsx`, `tests/worker.test.ts`
- Test: `tests/photoPath.test.ts`

**Interfaces:**
- Consumes: `photoForDay`, `upsertPhoto`, `createPhotoUploadUrl`, `signPhoto`, `latestShotList`, `photosForDays`, `setDraftPhoto` from Task 4; `localDay` from Task 8.
- Produces:
  - `photoObjectPath(day: string, fileName: string, now: number): string` → `<day>/<now>.<ext>`, ext from the file name, lowercased, only `jpg|jpeg|png|heic|webp`, otherwise throws `Error("Use a JPG, PNG, HEIC or WebP photo")`
  - `insertDraft(taskId, agentId, body, dryRun, photoPath?: string | null)`
  - `WorkerDeps` gains `photoForDay: (day: string) => Promise<string | null>` and `insertDraft` gains the fifth argument
  - Server actions `startPhotoUpload(day: string, fileName: string): Promise<{ ok: true; path: string; signedUrl: string } | { ok: false; error: string }>`, `completePhotoUpload(day: string, path: string, draftId: string | null): Promise<{ ok: true } | { ok: false; error: string }>`, `removeDraftPhoto(draftId: string): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Write the failing tests**

`tests/photoPath.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { photoObjectPath } from "../src/photoPath.js";

describe("photoObjectPath", () => {
  it("files the photo under its day with a fresh name", () => {
    expect(photoObjectPath("2026-09-16", "IMG_1234.JPG", 1700000000000)).toBe("2026-09-16/1700000000000.jpg");
  });
  it("refuses a file that is not a photo", () => {
    expect(() => photoObjectPath("2026-09-16", "notes.pdf", 1)).toThrow("Use a JPG, PNG, HEIC or WebP photo");
  });
  it("refuses a malformed day", () => {
    expect(() => photoObjectPath("16/09", "a.jpg", 1)).toThrow("Bad day");
  });
});
```

In `tests/worker.test.ts`, add to the `deps` factory:

```ts
  photoForDay: vi.fn(async () => null),
```

and add:

```ts
  it("attaches today's uploaded photo to the daily post", async () => {
    const { localDay } = await import("../src/shotList.js");
    const d = deps({ photoForDay: vi.fn(async () => "2026-09-16/1.jpg") });
    expect(await processOne(d, false)).toBe("produced");
    expect(d.photoForDay).toHaveBeenCalledWith(localDay(new Date()));
    expect(d.insertDraft).toHaveBeenCalledWith("t1", "a1", "A perfectly good draft body.", false, "2026-09-16/1.jpg");
  });
```

The worker now always passes a fifth argument to `insertDraft`: the day's photo path for a `daily_draft` (null when none was uploaded) and `null` for every other kind. Update every existing `expect(d.insertDraft).toHaveBeenCalledWith(...)` in `tests/worker.test.ts` that lists four arguments to add `null` as the fifth.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/photoPath.test.ts tests/worker.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the path helper**

`src/photoPath.ts`:

```ts
const EXT = /\.(jpe?g|png|heic|webp)$/i;

export function photoObjectPath(day: string, fileName: string, now: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Bad day");
  const m = fileName.match(EXT);
  if (!m) throw new Error("Use a JPG, PNG, HEIC or WebP photo");
  return `${day}/${now}.${m[1]!.toLowerCase()}`;
}
```

- [ ] **Step 4: Attach the photo in the worker**

In `src/db.ts`, replace `insertDraft` with:

```ts
export async function insertDraft(
  taskId: string, agentId: string, body: string, dryRun: boolean, photoPath: string | null = null,
): Promise<void> {
  const { error } = await supabase
    .from(table(dryRun))
    .insert({ task_id: taskId, agent_id: agentId, body, photo_path: photoPath });
  if (error) throw new Error(`insertDraft failed: ${error.message}`);
}
```

In `src/worker.ts`:
- `WorkerDeps.insertDraft` type becomes `(taskId: string, agentId: string, body: string, dryRun: boolean, photoPath: string | null) => Promise<void>;`
- add `photoForDay: (day: string) => Promise<string | null>;` to `WorkerDeps` and `photoForDay: store.photoForDay,` to `buildLiveDeps`
- replace `await deps.insertDraft(task.id, agent.id, run.body, dryRun);` with:

```ts
      // Only the daily post carries the day's photo; Denis took it from the shot list.
      const photo = task.kind === "daily_draft" ? await deps.photoForDay(localDay(new Date())) : null;
      await deps.insertDraft(task.id, agent.id, run.body, dryRun, photo);
```

Run: `npx vitest run tests/photoPath.test.ts tests/worker.test.ts`
Expected: PASS.

- [ ] **Step 5: Upload actions**

`web/app/photos/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { photoObjectPath } from "../../../src/photoPath.js";
import { createPhotoUploadUrl, setDraftPhoto, upsertPhoto } from "../../../src/posting/store.js";
import { currentUser } from "../lib/supabaseServer";

type Result = { ok: true } | { ok: false; error: string };

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

export async function startPhotoUpload(day: string, fileName: string): Promise<{ ok: true; path: string; signedUrl: string } | { ok: false; error: string }> {
  try {
    if (!(await currentUser())) return { ok: false, error: "Not authorized." };
    const path = photoObjectPath(day, fileName, Date.now());
    return { ok: true, path, signedUrl: await createPhotoUploadUrl(path) };
  } catch (err) {
    return fail(err);
  }
}

/** Saves the day's photo and, from a draft page, swaps it onto that draft too. */
export async function completePhotoUpload(day: string, path: string, draftId: string | null): Promise<Result> {
  try {
    if (!(await currentUser())) return { ok: false, error: "Not authorized." };
    if (!path.startsWith(`${day}/`)) return { ok: false, error: "Upload path does not match the day." };
    await upsertPhoto(day, path);
    if (draftId) {
      await setDraftPhoto(draftId, path);
      revalidatePath(`/drafts/${draftId}`);
    }
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function removeDraftPhoto(draftId: string): Promise<Result> {
  try {
    if (!(await currentUser())) return { ok: false, error: "Not authorized." };
    await setDraftPhoto(draftId, null);
    revalidatePath(`/drafts/${draftId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
```

- [ ] **Step 6: The card and an upload button**

`web/app/ShotListCard.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { ShotEntry } from "../../src/posting/store.js";
import { completePhotoUpload, startPhotoUpload } from "./photos/actions";

export function PhotoUpload({ day, draftId, label }: { day: string; draftId: string | null; label: string }) {
  const [status, setStatus] = useState("");
  async function onFile(file: File | undefined) {
    if (!file) return;
    setStatus("Uploading…");
    const start = await startPhotoUpload(day, file.name);
    if (!start.ok) { setStatus(start.error); return; }
    const res = await fetch(start.signedUrl, { method: "PUT", headers: { "Content-Type": file.type || "image/jpeg", "x-upsert": "true" }, body: file });
    if (!res.ok) { setStatus(`Upload failed (${res.status}). Try again.`); return; }
    const done = await completePhotoUpload(day, start.path, draftId);
    setStatus(done.ok ? "Uploaded." : done.error);
  }
  return (
    <label className="retry-btn">
      {label}
      <input type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      {status && <span className="hint"> {status}</span>}
    </label>
  );
}

export function ShotListCard({ list, uploaded }: { list: { week_start: string; entries: ShotEntry[] } | null; uploaded: Record<string, string> }) {
  if (!list) return null;
  return (
    <section className="brief-box">
      <h2>This week's photos</h2>
      <ul className="feed">
        {list.entries.map((e) => (
          <li key={e.date} className="feed-row">
            <strong>{new Date(`${e.date}T12:00:00+04:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</strong>{" "}
            [{e.subject}] {e.shot}
            <div className="hint">{e.angle}</div>
            {uploaded[e.date]
              ? <span className="hint">Uploaded. <PhotoUpload day={e.date} draftId={null} label="Replace" /></span>
              : <PhotoUpload day={e.date} draftId={null} label="Upload photo" />}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

In `web/app/page.tsx`: import `latestShotList, photosForDays` from `"../../src/posting/store.js"` and `ShotListCard` from `"./ShotListCard"`; add `latestShotList()` to the `Promise.all` as `shotList`; after it add `const uploaded = await photosForDays(shotList?.entries.map((e) => e.date) ?? []);`; pass `shotList={shotList} uploaded={uploaded}` to both `TodayView` and `OverviewView`.

In `web/app/TodayView.tsx` and `web/app/OverviewView.tsx`: add props `shotList: { week_start: string; entries: ShotEntry[] } | null; uploaded: Record<string, string>;` (import `type ShotEntry` from `"../../src/posting/store.js"`), and render `<ShotListCard list={shotList} uploaded={uploaded} />` directly after the brief section in each view.

- [ ] **Step 7: Photo on the draft page**

In `web/app/drafts/[id]/page.tsx`, import `signPhoto` from the store, `PhotoUpload` from `"../../ShotListCard"`, and `RemovePhotoButton` defined below. After loading `draft`:

```ts
  const photoUrl = draft.photo_path ? await signPhoto(draft.photo_path) : null;
  const photoDay = draft.created_at.slice(0, 10);
```

Right after `<article className="draft-full">{draft.body}</article>` add:

```tsx
      {draft.kind === "daily_draft" && (
        <section className="note-band">
          {photoUrl
            ? <img src={photoUrl} alt="Photo for this post" style={{ maxHeight: 320, borderRadius: 8 }} />
            : <p className="hint">No photo attached. Instagram needs one.</p>}
          <div className="action-row">
            <PhotoUpload day={photoDay} draftId={draft.id} label={photoUrl ? "Swap photo" : "Add photo"} />
            {photoUrl && <RemovePhotoButton draftId={draft.id} />}
          </div>
        </section>
      )}
```

Create `web/app/drafts/[id]/RemovePhotoButton.tsx`:

```tsx
"use client";

import { removeDraftPhoto } from "../../photos/actions";

export function RemovePhotoButton({ draftId }: { draftId: string }) {
  return <button type="button" onClick={() => removeDraftPhoto(draftId)}>Remove photo</button>;
}
```

- [ ] **Step 8: Test, build, commit, deploy**

Run: `npm run typecheck && npx vitest run --exclude tests/db.test.ts --exclude tests/postingDb.test.ts && npm run web:build`
Expected: no type errors, all pass, `Compiled successfully`.

```bash
git add src/photoPath.ts tests/photoPath.test.ts src/worker.ts tests/worker.test.ts src/db.ts web/app/photos web/app/ShotListCard.tsx web/app/TodayView.tsx web/app/OverviewView.tsx web/app/page.tsx "web/app/drafts/[id]"
git commit -m "feat(shots): upload the week's photos and attach them to daily posts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```

Run: `npx vitest run tests/db.test.ts tests/postingDb.test.ts`
Expected: PASS (confirms `insertDraft` with `photo_path` against production).

---

### Task 10: End to end proof on production and notes

**Files:**
- Modify: `docs/build-log.md`, `CLAUDE.md`

- [ ] **Step 1: Accounts**

Denis presses Connect Meta and Connect Threads on production. Expected on `/accounts`: @becoming_denis, @attune and @thesolutiontape each appear for Facebook, Instagram and Threads, ready or not ready with a reason. Record which are not ready.

- [ ] **Step 2: Post now to every ready account**

On one approved daily post with a photo attached, tick every ready account and press Post now. Expected within two minutes: every row `posted` with a working view link. Denis confirms each post on his phone, then deletes them in the apps if he does not want them live.

- [ ] **Step 3: Scheduled with the Mac off**

Schedule the same post to one ready account five minutes ahead, then Denis shuts the Mac down. Expected: row `posted` after the time; check `net._http_response` for 200s during that window.

- [ ] **Step 4: Shot list from a real bank**

Approve the next real weekly angle bank (or re-approve through a fresh `weekly_angles` draft). Expected after the next worker run: the dashboard shows This week's photos with seven days, no The Solution, and every shot something Denis can photograph himself. Upload one photo for tomorrow; after tomorrow's 07:00 run, the daily post shows that photo, and posting it to Instagram succeeds.

- [ ] **Step 5: Notes**

Append a `## 2026-09-xx — Posting to Meta and the weekly shot list` section to `docs/build-log.md` with what shipped (commit range), what was proven in steps 1 to 4, which accounts were not ready and why, and anything that only failed on contact with Meta. In `CLAUDE.md` Recent Changes, add one entry and delete the oldest so five remain. Add to Hard-Won Rules anything from this build that would bite again.

```bash
git add docs/build-log.md CLAUDE.md
git commit -m "docs: posting to Meta and the weekly shot list

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```

Not done until steps 1 to 4 have passed on production and Denis has seen a real post go out.
