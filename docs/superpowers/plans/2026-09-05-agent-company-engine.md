# Agent Company Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three agents (Strategist, Writer, Chief of Staff) produce drafts on a schedule into Supabase, and Denis approves or declines them from a CLI, with each verdict moving the agent up or down the autonomy ladder.

**Architecture:** Supabase holds all state. A Node worker on Denis's Mac claims one task at a time under a Postgres row lock, spawns a headless Claude Code session for that agent, asserts the run produced usable output, and writes a draft row. A separate CLI reads pending drafts and records verdicts. All ladder and capacity logic is pure functions, unit tested without a database or a model call.

**Tech Stack:** TypeScript (strict), Node 20+, `@supabase/supabase-js`, `vitest`, `tsx`. No agent framework, no ORM, no web server in this plan.

## Global Constraints

Every task's requirements implicitly include these. Values are copied verbatim from `docs/superpowers/specs/2026-09-05-agent-company-design.md`.

- **No agent publishes, sends, or spends anything in this plan.** There is no Publisher and no Blotato integration. Drafts land in the database and stop there.
- **Promotion:** 5 consecutive approvals with no edit.
- **Demotion:** 2 declines within the last 5 verdicts, one level, immediately.
- **Approve-after-edit** counts as neither: resets the promotion streak, no level change.
- **Backpressure:** maximum 3 drafts pending approval per agent. At the cap the agent produces nothing.
- **Instruction cap:** 30 rules per agent. Full decline history lives in `feedback`.
- **Turn cap:** every agent run has a fixed maximum number of tool-calling turns.
- **Output assertion:** a run that produces nothing, or produces the previous draft verbatim, is recorded as `failed`, never as success.
- **Levels are 1–4.** Every agent starts at level 1. An agent's `max_level` caps promotion regardless of streak.
- **Dry-run mode exists from day one** and writes to `drafts_dryrun`, never `drafts`.
- Local single-user tool. It uses the Supabase **service role key**, kept in `.env`, which is gitignored. Do not commit keys.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0001_init.sql` | Schema and the `claim_next_task()` function |
| `src/types.ts` | Shared types only. No logic. |
| `src/ladder.ts` | Pure. Verdict → new agent level/streak/history. |
| `src/capacity.ts` | Pure. Pending-draft count → may this agent produce? |
| `src/output.ts` | Pure. Is this run's output usable? |
| `src/db.ts` | Supabase client and every query. The only file that touches the network. |
| `src/runner.ts` | Spawns a headless Claude Code session, returns its text. |
| `src/worker.ts` | The loop that ties the above together. |
| `src/cli.ts` | Review CLI: list pending drafts, record verdicts. |
| `src/seed.ts` | Inserts the three v1 agents and their schedules. |

Pure logic is separated from I/O deliberately: Tasks 2–4 are fully tested with no database and no model calls, which is most of the system's correctness for none of the cost.

---

### Task 1: Project scaffold and schema

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `vitest.config.ts`
- Create: `supabase/migrations/0001_init.sql`
- Create: `src/types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the tables every later task reads and writes; `Verdict`, `AgentState`, `TaskRow`, `DraftRow` types imported by Tasks 2–9.

- [ ] **Step 1: Initialise the project**

```bash
cd ~/Desktop/agentco
npm init -y
npm install @supabase/supabase-js dotenv
npm install -D typescript tsx vitest @types/node
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Set `"type": "module"` and scripts in `package.json`**

Add these keys to the generated `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "worker": "tsx src/worker.ts",
    "review": "tsx src/cli.ts",
    "seed": "tsx src/seed.ts"
  }
}
```

- [ ] **Step 4: Write `.gitignore` and `.env.example`**

`.gitignore`:

```
node_modules
dist
.env
```

`.env.example`:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=replace-me
```

- [ ] **Step 5: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
});
```

- [ ] **Step 6: Write the migration**

`supabase/migrations/0001_init.sql`:

```sql
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
```

- [ ] **Step 7: Apply the migration**

Create a Supabase project named `agentco` in the dashboard, then run the SQL above in its SQL editor. Copy the project URL and **service role** key into a new `.env` (not `.env.example`).

Verify: run `select count(*) from agents;` in the SQL editor. Expected: `0`, with no error.

- [ ] **Step 8: Write `src/types.ts`**

```ts
export type Verdict = "approved" | "approved_with_edit" | "declined";

export type AgentState = {
  level: number;
  maxLevel: number;
  streak: number;
  recent: Verdict[];
};

export type TaskKind = "weekly_angles" | "daily_draft" | "brief";
export type TaskState = "queued" | "running" | "done" | "failed";

export type TaskRow = {
  id: string;
  agent_id: string;
  kind: TaskKind;
  state: TaskState;
  due_at: string;
  error: string | null;
};

export type AgentRow = {
  id: string;
  key: string;
  display_name: string;
  department: string;
  level: number;
  max_level: number;
  streak: number;
  recent_verdicts: Verdict[];
  instructions: string;
  turn_cap: number;
  enabled: boolean;
};

export type DraftRow = {
  id: string;
  task_id: string;
  agent_id: string;
  body: string;
  status: "pending" | "approved" | "declined";
  created_at: string;
};
```

- [ ] **Step 9: Verify and commit**

Run: `npm run typecheck`
Expected: no output, exit 0.

```bash
git add -A
git commit -m "feat: project scaffold and schema"
```

---

### Task 2: The autonomy ladder

**Files:**
- Create: `src/ladder.ts`
- Test: `tests/ladder.test.ts`

**Interfaces:**
- Consumes: `Verdict`, `AgentState` from `src/types.ts`.
- Produces: `applyVerdict(state: AgentState, verdict: Verdict): AgentState` — pure, returns a new state, never mutates. Used by Task 8.

- [ ] **Step 1: Write the failing tests**

`tests/ladder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyVerdict } from "../src/ladder.js";
import type { AgentState } from "../src/types.js";

const fresh = (over: Partial<AgentState> = {}): AgentState => ({
  level: 1, maxLevel: 4, streak: 0, recent: [], ...over,
});

describe("promotion", () => {
  it("promotes on the fifth consecutive clean approval", () => {
    let s = fresh();
    for (let i = 0; i < 4; i++) s = applyVerdict(s, "approved");
    expect(s.level).toBe(1);
    expect(s.streak).toBe(4);

    s = applyVerdict(s, "approved");
    expect(s.level).toBe(2);
    expect(s.streak).toBe(0);
  });

  it("never promotes past maxLevel", () => {
    let s = fresh({ level: 2, maxLevel: 2, streak: 4 });
    s = applyVerdict(s, "approved");
    expect(s.level).toBe(2);
  });

  it("never promotes past level 4", () => {
    let s = fresh({ level: 4, streak: 4 });
    s = applyVerdict(s, "approved");
    expect(s.level).toBe(4);
  });
});

describe("approve-after-edit", () => {
  it("resets the streak without changing the level", () => {
    let s = fresh({ streak: 4 });
    s = applyVerdict(s, "approved_with_edit");
    expect(s.streak).toBe(0);
    expect(s.level).toBe(1);
  });
});

describe("demotion", () => {
  it("demotes on the second decline within the last five verdicts", () => {
    let s = fresh({ level: 3 });
    s = applyVerdict(s, "declined");
    expect(s.level).toBe(3);

    s = applyVerdict(s, "declined");
    expect(s.level).toBe(2);
  });

  it("does not demote when the declines are more than five verdicts apart", () => {
    let s = fresh({ level: 3 });
    s = applyVerdict(s, "declined");
    for (let i = 0; i < 5; i++) s = applyVerdict(s, "approved_with_edit");
    s = applyVerdict(s, "declined");
    expect(s.level).toBe(3);
  });

  it("clears history on demotion so it takes two fresh declines to demote again", () => {
    let s = fresh({ level: 4 });
    s = applyVerdict(s, "declined");
    s = applyVerdict(s, "declined");
    expect(s.level).toBe(3);
    expect(s.recent).toEqual([]);

    s = applyVerdict(s, "declined");
    expect(s.level).toBe(3);
  });

  it("never demotes below level 1", () => {
    let s = fresh({ level: 1 });
    s = applyVerdict(s, "declined");
    s = applyVerdict(s, "declined");
    expect(s.level).toBe(1);
  });

  it("resets the promotion streak", () => {
    let s = fresh({ streak: 4 });
    s = applyVerdict(s, "declined");
    expect(s.streak).toBe(0);
  });
});

describe("purity", () => {
  it("does not mutate the input state", () => {
    const s = fresh({ streak: 2 });
    applyVerdict(s, "approved");
    expect(s.streak).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ladder.test.ts`
Expected: FAIL — `Failed to resolve import "../src/ladder.js"`.

- [ ] **Step 3: Write the implementation**

`src/ladder.ts`:

```ts
import type { AgentState, Verdict } from "./types.js";

export const PROMOTE_AFTER = 5;
export const DEMOTE_ON_DECLINES = 2;
export const DECLINE_WINDOW = 5;

/**
 * Applies one verdict to an agent's standing.
 *
 * Demotion is checked before promotion because a decline can never also be a
 * promotion, and demotion is the safety mechanism — it wins ties.
 *
 * On demotion the history is cleared: without that, the same two declines sit
 * in the window and demote the agent again on the very next verdict.
 */
export function applyVerdict(state: AgentState, verdict: Verdict): AgentState {
  const recent = [...state.recent, verdict].slice(-DECLINE_WINDOW);

  if (verdict === "declined") {
    const declines = recent.filter((v) => v === "declined").length;
    if (declines >= DEMOTE_ON_DECLINES) {
      return {
        ...state,
        level: Math.max(1, state.level - 1),
        streak: 0,
        recent: [],
      };
    }
    return { ...state, streak: 0, recent };
  }

  if (verdict === "approved_with_edit") {
    return { ...state, streak: 0, recent };
  }

  const streak = state.streak + 1;
  if (streak >= PROMOTE_AFTER) {
    const ceiling = Math.min(4, state.maxLevel);
    return {
      ...state,
      level: Math.min(ceiling, state.level + 1),
      streak: 0,
      recent,
    };
  }
  return { ...state, streak, recent };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/ladder.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ladder.ts tests/ladder.test.ts
git commit -m "feat: autonomy ladder — promote at 5, demote at 2 of 5"
```

---

### Task 3: Backpressure

**Files:**
- Create: `src/capacity.ts`
- Test: `tests/capacity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MAX_PENDING_DRAFTS` constant and `canProduce(pendingCount: number): boolean`. Used by Task 7.

- [ ] **Step 1: Write the failing tests**

`tests/capacity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canProduce, MAX_PENDING_DRAFTS } from "../src/capacity.js";

describe("backpressure", () => {
  it("caps at three pending drafts", () => {
    expect(MAX_PENDING_DRAFTS).toBe(3);
  });

  it("allows production below the cap", () => {
    expect(canProduce(0)).toBe(true);
    expect(canProduce(2)).toBe(true);
  });

  it("stops production at the cap", () => {
    expect(canProduce(3)).toBe(false);
  });

  it("stops production above the cap", () => {
    expect(canProduce(9)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/capacity.test.ts`
Expected: FAIL — cannot resolve `../src/capacity.js`.

- [ ] **Step 3: Write the implementation**

`src/capacity.ts`:

```ts
/**
 * An agent stops producing once it has this many drafts awaiting a verdict.
 *
 * This makes Denis's review capacity throttle the system, rather than letting
 * a backlog build up with his name on it that he then avoids.
 */
export const MAX_PENDING_DRAFTS = 3;

export function canProduce(pendingCount: number): boolean {
  return pendingCount < MAX_PENDING_DRAFTS;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/capacity.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/capacity.ts tests/capacity.test.ts
git commit -m "feat: backpressure at three pending drafts"
```

---

### Task 4: Output assertion

**Files:**
- Create: `src/output.ts`
- Test: `tests/output.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `assertUsableOutput(body: string, previous: string | null): OutputCheck`, where `OutputCheck` is `{ ok: true } | { ok: false; reason: string }`. Used by Task 7.

- [ ] **Step 1: Write the failing tests**

`tests/output.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assertUsableOutput } from "../src/output.js";

const good = "Most women think a plateau means they need to train harder.";

describe("assertUsableOutput", () => {
  it("accepts real output", () => {
    expect(assertUsableOutput(good, null)).toEqual({ ok: true });
  });

  it("rejects an empty run", () => {
    const r = assertUsableOutput("", null);
    expect(r.ok).toBe(false);
  });

  it("rejects whitespace only", () => {
    const r = assertUsableOutput("   \n\t ", null);
    expect(r.ok).toBe(false);
  });

  it("rejects output too short to be a draft", () => {
    const r = assertUsableOutput("OK", null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("too short");
  });

  it("rejects output identical to the previous draft", () => {
    const r = assertUsableOutput(good, good);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("identical");
  });

  it("ignores surrounding whitespace when comparing to the previous draft", () => {
    const r = assertUsableOutput(`\n  ${good}  \n`, good);
    expect(r.ok).toBe(false);
  });

  it("accepts output that differs from the previous draft", () => {
    expect(assertUsableOutput(good, "Something else entirely, at length."))
      .toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/output.test.ts`
Expected: FAIL — cannot resolve `../src/output.js`.

- [ ] **Step 3: Write the implementation**

`src/output.ts`:

```ts
export type OutputCheck = { ok: true } | { ok: false; reason: string };

/** Shorter than this is an acknowledgement, not a draft. */
export const MIN_DRAFT_CHARS = 20;

/**
 * A run that "succeeds" while producing nothing is the failure mode that hides
 * longest — it looks fine in every log and every dashboard. Every run must
 * prove it produced something usable before it is recorded as done.
 */
export function assertUsableOutput(
  body: string,
  previous: string | null,
): OutputCheck {
  const trimmed = body.trim();

  if (trimmed.length === 0) {
    return { ok: false, reason: "run produced no output" };
  }
  if (trimmed.length < MIN_DRAFT_CHARS) {
    return {
      ok: false,
      reason: `output too short to be a draft (${trimmed.length} chars)`,
    };
  }
  if (previous !== null && trimmed === previous.trim()) {
    return { ok: false, reason: "output identical to the previous draft" };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/output.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/output.ts tests/output.test.ts
git commit -m "feat: reject runs that succeed without producing output"
```

---

### Task 5: Database layer

**Files:**
- Create: `src/db.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Consumes: types from `src/types.ts`; the schema from Task 1.
- Produces, all used by Tasks 7–9:
  - `supabase` — the configured client
  - `claimNextTask(): Promise<TaskRow | null>`
  - `getAgent(id: string): Promise<AgentRow>`
  - `countPendingDrafts(agentId: string): Promise<number>`
  - `latestDraftBody(agentId: string): Promise<string | null>`
  - `insertDraft(taskId: string, agentId: string, body: string, dryRun: boolean): Promise<void>`
  - `finishTask(id: string, state: "done" | "failed", error?: string): Promise<void>`
  - `logEvent(kind: string, detail: Record<string, unknown>, agentId?: string, taskId?: string): Promise<void>`

- [ ] **Step 1: Write the implementation**

This task is I/O against a live database, so implementation comes first and the test in Step 3 exercises it end to end.

`src/db.ts`:

```ts
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import type { AgentRow, TaskRow } from "./types.js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Copy .env.example to .env and fill it in.",
  );
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

export async function claimNextTask(): Promise<TaskRow | null> {
  const { data, error } = await supabase.rpc("claim_next_task");
  if (error) throw new Error(`claim_next_task failed: ${error.message}`);
  const rows = (data ?? []) as TaskRow[];
  return rows[0] ?? null;
}

export async function getAgent(id: string): Promise<AgentRow> {
  const { data, error } = await supabase
    .from("agents").select("*").eq("id", id).single();
  if (error) throw new Error(`getAgent failed: ${error.message}`);
  return data as AgentRow;
}

export async function countPendingDrafts(agentId: string): Promise<number> {
  const { count, error } = await supabase
    .from("drafts")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", agentId)
    .eq("status", "pending");
  if (error) throw new Error(`countPendingDrafts failed: ${error.message}`);
  return count ?? 0;
}

export async function latestDraftBody(agentId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("drafts")
    .select("body")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`latestDraftBody failed: ${error.message}`);
  return data?.[0]?.body ?? null;
}

export async function insertDraft(
  taskId: string, agentId: string, body: string, dryRun: boolean,
): Promise<void> {
  const table = dryRun ? "drafts_dryrun" : "drafts";
  const { error } = await supabase
    .from(table)
    .insert({ task_id: taskId, agent_id: agentId, body });
  if (error) throw new Error(`insertDraft failed: ${error.message}`);
}

export async function finishTask(
  id: string, state: "done" | "failed", error?: string,
): Promise<void> {
  const { error: e } = await supabase
    .from("tasks")
    .update({ state, error: error ?? null, finished_at: new Date().toISOString() })
    .eq("id", id);
  if (e) throw new Error(`finishTask failed: ${e.message}`);
}

export async function logEvent(
  kind: string,
  detail: Record<string, unknown>,
  agentId?: string,
  taskId?: string,
): Promise<void> {
  const { error } = await supabase
    .from("events")
    .insert({ kind, detail, agent_id: agentId ?? null, task_id: taskId ?? null });
  if (error) throw new Error(`logEvent failed: ${error.message}`);
}
```

- [ ] **Step 2: Write the integration test**

`tests/db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  supabase, claimNextTask, countPendingDrafts, insertDraft,
  finishTask, latestDraftBody,
} from "../src/db.js";

let agentId: string;

beforeAll(async () => {
  const { data, error } = await supabase
    .from("agents")
    .insert({ key: `test_${Date.now()}`, display_name: "Test", department: "Test" })
    .select().single();
  if (error) throw error;
  agentId = data.id;
});

afterAll(async () => {
  await supabase.from("agents").delete().eq("id", agentId);
});

describe("claim", () => {
  it("returns null when nothing is due", async () => {
    expect(await claimNextTask()).toBeNull();
  });

  it("claims a due task exactly once", async () => {
    const { data } = await supabase
      .from("tasks")
      .insert({ agent_id: agentId, kind: "daily_draft" })
      .select().single();

    const first = await claimNextTask();
    expect(first?.id).toBe(data!.id);
    expect(first?.state).toBe("running");

    // A second cron firing must not get the same row back.
    expect(await claimNextTask()).toBeNull();

    await finishTask(data!.id, "done");
  });

  it("does not claim a task that is not yet due", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await supabase.from("tasks")
      .insert({ agent_id: agentId, kind: "daily_draft", due_at: future });
    expect(await claimNextTask()).toBeNull();
  });
});

describe("drafts", () => {
  it("counts only pending drafts for the agent", async () => {
    const { data: t } = await supabase.from("tasks")
      .insert({ agent_id: agentId, kind: "daily_draft" }).select().single();

    expect(await countPendingDrafts(agentId)).toBe(0);
    await insertDraft(t!.id, agentId, "A first draft body, long enough.", false);
    expect(await countPendingDrafts(agentId)).toBe(1);
  });

  it("returns the newest draft body", async () => {
    expect(await latestDraftBody(agentId)).toContain("first draft body");
  });

  it("writes dry-run output to the scratch table only", async () => {
    const { data: t } = await supabase.from("tasks")
      .insert({ agent_id: agentId, kind: "daily_draft" }).select().single();

    const before = await countPendingDrafts(agentId);
    await insertDraft(t!.id, agentId, "A dry run body, long enough to pass.", true);
    expect(await countPendingDrafts(agentId)).toBe(before);

    const { count } = await supabase.from("drafts_dryrun")
      .select("id", { count: "exact", head: true }).eq("agent_id", agentId);
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run tests/db.test.ts`
Expected: PASS, 6 tests. If it fails with a connection error, check `.env` holds the service role key, not the anon key.

- [ ] **Step 4: Commit**

```bash
git add src/db.ts tests/db.test.ts
git commit -m "feat: database layer with locked task claiming"
```

---

### Task 6: The agent runner

**Files:**
- Create: `src/runner.ts`
- Test: `tests/runner.test.ts`

**Interfaces:**
- Consumes: `AgentRow` from `src/types.ts`.
- Produces: `runAgent(agent: AgentRow, taskPrompt: string): Promise<RunResult>`, where `RunResult` is `{ ok: true; body: string } | { ok: false; reason: string }`. Used by Task 7.

- [ ] **Step 1: Confirm the Claude Code CLI flags**

Run: `claude --help`

Find the flag for non-interactive/print mode (expected: `-p` / `--print`) and the flag that limits agentic turns (expected: `--max-turns`). **If either name differs on the installed version, use the real name throughout this task** — do not assume the names below are correct.

Record what you found in the commit message for this task.

- [ ] **Step 2: Write the failing test**

The test drives a fake spawn so it never invokes a model or costs anything.

`tests/runner.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildArgs, interpretRun } from "../src/runner.js";

const agent = { turn_cap: 8 } as any;

describe("buildArgs", () => {
  it("passes print mode and the agent's turn cap", () => {
    const args = buildArgs(agent);
    expect(args).toContain("--print");
    expect(args).toContain("--max-turns");
    expect(args[args.indexOf("--max-turns") + 1]).toBe("8");
  });
});

describe("interpretRun", () => {
  it("returns the trimmed stdout on success", () => {
    expect(interpretRun(0, "  a draft body  ", "")).toEqual({
      ok: true, body: "a draft body",
    });
  });

  it("fails on a non-zero exit code and keeps stderr", () => {
    const r = interpretRun(1, "", "boom");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("boom");
  });

  it("fails on a zero exit code with empty stdout", () => {
    const r = interpretRun(0, "   ", "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("no output");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/runner.test.ts`
Expected: FAIL — cannot resolve `../src/runner.js`.

- [ ] **Step 4: Write the implementation**

`src/runner.ts`:

```ts
import { spawn } from "node:child_process";
import type { AgentRow } from "./types.js";

export type RunResult =
  | { ok: true; body: string }
  | { ok: false; reason: string };

/**
 * Turn cap comes from the agent row so an expensive agent can be tightened
 * without a code change. Without it, a research loop can spiral.
 */
export function buildArgs(agent: Pick<AgentRow, "turn_cap">): string[] {
  return ["--print", "--max-turns", String(agent.turn_cap)];
}

export function interpretRun(
  code: number, stdout: string, stderr: string,
): RunResult {
  if (code !== 0) {
    return { ok: false, reason: `claude exited ${code}: ${stderr.trim()}` };
  }
  const body = stdout.trim();
  if (body.length === 0) {
    return { ok: false, reason: "claude exited 0 but produced no output" };
  }
  return { ok: true, body };
}

export function runAgent(agent: AgentRow, taskPrompt: string): Promise<RunResult> {
  const prompt = [
    agent.instructions.trim(),
    "",
    "---",
    "",
    taskPrompt.trim(),
  ].join("\n");

  return new Promise((resolve) => {
    const child = spawn("claude", buildArgs(agent), {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("error", (e) =>
      resolve({ ok: false, reason: `could not spawn claude: ${e.message}` }));
    child.on("close", (code) =>
      resolve(interpretRun(code ?? 1, stdout, stderr)));

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/runner.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/runner.ts tests/runner.test.ts
git commit -m "feat: agent runner spawning headless Claude Code

Verified CLI flags against claude --help: <record the actual flag names here>"
```

---

### Task 7: The worker loop

**Files:**
- Create: `src/prompts.ts`
- Create: `src/worker.ts`
- Test: `tests/worker.test.ts`

**Interfaces:**
- Consumes: `claimNextTask`, `getAgent`, `countPendingDrafts`, `latestDraftBody`, `insertDraft`, `finishTask`, `logEvent` (Task 5); `canProduce` (Task 3); `assertUsableOutput` (Task 4); `runAgent` (Task 6).
- Produces: `processOne(deps: WorkerDeps, dryRun: boolean): Promise<WorkerOutcome>`, where `WorkerOutcome` is `"idle" | "produced" | "skipped_at_capacity" | "failed"`. Injecting `deps` is what makes the loop testable without a database or a model.

- [ ] **Step 1: Write `src/prompts.ts`**

```ts
import type { TaskKind } from "./types.js";

export const TASK_PROMPTS: Record<TaskKind, string> = {
  weekly_angles:
    "Propose 5 to 7 angles for this week's content. Use the divergence skill: " +
    "reject your own first drafts and reframe until the angles are ones only " +
    "this business could publish. Output the angles as a numbered list and " +
    "nothing else.",
  daily_draft:
    "Write one post from the approved angle bank. Match the voice rules in " +
    "your instructions exactly. Output only the post text, with no preamble, " +
    "no options and no commentary.",
  brief:
    "Write this morning's brief: what ran overnight, what is waiting on Denis, " +
    "and what failed. If nothing ran, say so explicitly rather than returning " +
    "an empty brief. Keep it under 150 words.",
};
```

- [ ] **Step 2: Write the failing tests**

`tests/worker.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { processOne } from "../src/worker.js";
import type { WorkerDeps } from "../src/worker.js";

const task = { id: "t1", agent_id: "a1", kind: "daily_draft", state: "running",
               due_at: "", error: null } as any;
const agent = { id: "a1", key: "writer", display_name: "Writer", department: "Growth",
                level: 1, max_level: 4, streak: 0, recent_verdicts: [],
                instructions: "You are the Writer.", turn_cap: 8, enabled: true } as any;

const deps = (over: Partial<WorkerDeps> = {}): WorkerDeps => ({
  claimNextTask: vi.fn(async () => task),
  getAgent: vi.fn(async () => agent),
  countPendingDrafts: vi.fn(async () => 0),
  latestDraftBody: vi.fn(async () => null),
  insertDraft: vi.fn(async () => {}),
  finishTask: vi.fn(async () => {}),
  logEvent: vi.fn(async () => {}),
  runAgent: vi.fn(async () => ({ ok: true, body: "A perfectly good draft body." })),
  ...over,
});

describe("processOne", () => {
  it("is idle when no task is due", async () => {
    const d = deps({ claimNextTask: vi.fn(async () => null) });
    expect(await processOne(d, false)).toBe("idle");
    expect(d.runAgent).not.toHaveBeenCalled();
  });

  it("writes a draft and marks the task done", async () => {
    const d = deps();
    expect(await processOne(d, false)).toBe("produced");
    expect(d.insertDraft).toHaveBeenCalledWith("t1", "a1", "A perfectly good draft body.", false);
    expect(d.finishTask).toHaveBeenCalledWith("t1", "done");
  });

  it("does not run the agent when it is at the draft cap", async () => {
    const d = deps({ countPendingDrafts: vi.fn(async () => 3) });
    expect(await processOne(d, false)).toBe("skipped_at_capacity");
    expect(d.runAgent).not.toHaveBeenCalled();
    expect(d.finishTask).toHaveBeenCalledWith("t1", "done");
  });

  it("fails the task when the run errors", async () => {
    const d = deps({ runAgent: vi.fn(async () => ({ ok: false, reason: "claude exited 1" })) });
    expect(await processOne(d, false)).toBe("failed");
    expect(d.insertDraft).not.toHaveBeenCalled();
    expect(d.finishTask).toHaveBeenCalledWith("t1", "failed", "claude exited 1");
  });

  it("fails the task when the run repeats the previous draft", async () => {
    const d = deps({
      latestDraftBody: vi.fn(async () => "A perfectly good draft body."),
    });
    expect(await processOne(d, false)).toBe("failed");
    expect(d.insertDraft).not.toHaveBeenCalled();
  });

  it("routes dry-run output to the scratch table", async () => {
    const d = deps();
    await processOne(d, true);
    expect(d.insertDraft).toHaveBeenCalledWith("t1", "a1", "A perfectly good draft body.", true);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/worker.test.ts`
Expected: FAIL — cannot resolve `../src/worker.js`.

- [ ] **Step 4: Write the implementation**

`src/worker.ts`:

```ts
import { canProduce } from "./capacity.js";
import { assertUsableOutput } from "./output.js";
import { TASK_PROMPTS } from "./prompts.js";
import type { AgentRow, TaskRow } from "./types.js";
import type { RunResult } from "./runner.js";
import * as db from "./db.js";
import { runAgent } from "./runner.js";

export type WorkerOutcome =
  | "idle" | "produced" | "skipped_at_capacity" | "failed";

export type WorkerDeps = {
  claimNextTask: () => Promise<TaskRow | null>;
  getAgent: (id: string) => Promise<AgentRow>;
  countPendingDrafts: (agentId: string) => Promise<number>;
  latestDraftBody: (agentId: string) => Promise<string | null>;
  insertDraft: (taskId: string, agentId: string, body: string, dryRun: boolean) => Promise<void>;
  finishTask: (id: string, state: "done" | "failed", error?: string) => Promise<void>;
  logEvent: (kind: string, detail: Record<string, unknown>, agentId?: string, taskId?: string) => Promise<void>;
  runAgent: (agent: AgentRow, prompt: string) => Promise<RunResult>;
};

export const liveDeps: WorkerDeps = {
  claimNextTask: db.claimNextTask,
  getAgent: db.getAgent,
  countPendingDrafts: db.countPendingDrafts,
  latestDraftBody: db.latestDraftBody,
  insertDraft: db.insertDraft,
  finishTask: db.finishTask,
  logEvent: db.logEvent,
  runAgent,
};

export async function processOne(
  deps: WorkerDeps, dryRun: boolean,
): Promise<WorkerOutcome> {
  const task = await deps.claimNextTask();
  if (!task) return "idle";

  const agent = await deps.getAgent(task.agent_id);

  const pending = await deps.countPendingDrafts(agent.id);
  if (!canProduce(pending)) {
    await deps.logEvent("skipped_at_capacity", { pending }, agent.id, task.id);
    await deps.finishTask(task.id, "done");
    return "skipped_at_capacity";
  }

  const run = await deps.runAgent(agent, TASK_PROMPTS[task.kind]);
  if (!run.ok) {
    await deps.logEvent("run_failed", { reason: run.reason }, agent.id, task.id);
    await deps.finishTask(task.id, "failed", run.reason);
    return "failed";
  }

  const previous = await deps.latestDraftBody(agent.id);
  const check = assertUsableOutput(run.body, previous);
  if (!check.ok) {
    await deps.logEvent("output_rejected", { reason: check.reason }, agent.id, task.id);
    await deps.finishTask(task.id, "failed", check.reason);
    return "failed";
  }

  await deps.insertDraft(task.id, agent.id, run.body, dryRun);
  await deps.logEvent("draft_created", { chars: run.body.length, dryRun }, agent.id, task.id);
  await deps.finishTask(task.id, "done");
  return "produced";
}

/** Drains every due task, then exits. Cron runs this; it is not a daemon. */
export async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  for (;;) {
    const outcome = await processOne(liveDeps, dryRun);
    console.log(`[worker] ${outcome}${dryRun ? " (dry run)" : ""}`);
    if (outcome === "idle") break;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/worker.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/worker.ts src/prompts.ts tests/worker.test.ts
git commit -m "feat: worker loop with backpressure, output assertion and dry-run mode"
```

---

### Task 8: The review CLI

**Files:**
- Create: `src/review.ts`
- Create: `src/cli.ts`
- Test: `tests/review.test.ts`

**Interfaces:**
- Consumes: `applyVerdict` (Task 2); `supabase` (Task 5).
- Produces: `recordVerdict(deps: ReviewDeps, draftId: string, agentId: string, verdict: Verdict, reason?: string): Promise<AgentState>` — writes the approval, appends a feedback row when declined, and persists the new agent standing.

- [ ] **Step 1: Write the failing tests**

`tests/review.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { recordVerdict } from "../src/review.js";
import type { ReviewDeps } from "../src/review.js";

const state = { level: 1, maxLevel: 4, streak: 4, recent: [] };

const deps = (over: Partial<ReviewDeps> = {}): ReviewDeps => ({
  loadState: vi.fn(async () => ({ ...state })),
  saveState: vi.fn(async () => {}),
  setDraftStatus: vi.fn(async () => {}),
  insertApproval: vi.fn(async () => {}),
  insertFeedback: vi.fn(async () => {}),
  ...over,
});

describe("recordVerdict", () => {
  it("promotes on the fifth clean approval and saves the new standing", async () => {
    const d = deps();
    const next = await recordVerdict(d, "d1", "a1", "approved");
    expect(next.level).toBe(2);
    expect(d.saveState).toHaveBeenCalledWith("a1", next);
    expect(d.setDraftStatus).toHaveBeenCalledWith("d1", "approved");
  });

  it("marks an edited approval as approved on the draft", async () => {
    const d = deps();
    await recordVerdict(d, "d1", "a1", "approved_with_edit");
    expect(d.setDraftStatus).toHaveBeenCalledWith("d1", "approved");
  });

  it("writes the decline reason to feedback", async () => {
    const d = deps();
    await recordVerdict(d, "d1", "a1", "declined", "too salesy");
    expect(d.insertFeedback).toHaveBeenCalledWith("a1", "too salesy");
    expect(d.setDraftStatus).toHaveBeenCalledWith("d1", "declined");
  });

  it("does not write feedback when there is no decline reason", async () => {
    const d = deps();
    await recordVerdict(d, "d1", "a1", "approved");
    expect(d.insertFeedback).not.toHaveBeenCalled();
  });

  it("counts one rule per non-empty instruction line", async () => {
    const { countRules, MAX_RULES } = await import("../src/review.js");
    expect(MAX_RULES).toBe(30);
    expect(countRules("one\n\n  two  \nthree\n")).toBe(3);
    expect(countRules("")).toBe(0);
  });

  it("always records the approval row", async () => {
    const d = deps();
    await recordVerdict(d, "d1", "a1", "declined", "wrong angle");
    expect(d.insertApproval).toHaveBeenCalledWith("d1", "declined", "wrong angle");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/review.test.ts`
Expected: FAIL — cannot resolve `../src/review.js`.

- [ ] **Step 3: Write `src/review.ts`**

```ts
import { applyVerdict } from "./ladder.js";
import { supabase } from "./db.js";
import type { AgentState, Verdict } from "./types.js";

/** Instructions are one rule per non-empty line. */
export function countRules(instructions: string): number {
  return instructions.split("\n").map((l) => l.trim()).filter(Boolean).length;
}

export const MAX_RULES = 30;

export type ReviewDeps = {
  loadState: (agentId: string) => Promise<AgentState>;
  saveState: (agentId: string, state: AgentState) => Promise<void>;
  setDraftStatus: (draftId: string, status: "approved" | "declined") => Promise<void>;
  insertApproval: (draftId: string, verdict: Verdict, reason?: string) => Promise<void>;
  insertFeedback: (agentId: string, reason: string) => Promise<void>;
};

export async function recordVerdict(
  deps: ReviewDeps,
  draftId: string,
  agentId: string,
  verdict: Verdict,
  reason?: string,
): Promise<AgentState> {
  await deps.insertApproval(draftId, verdict, reason);
  await deps.setDraftStatus(draftId, verdict === "declined" ? "declined" : "approved");

  if (verdict === "declined" && reason) {
    await deps.insertFeedback(agentId, reason);
  }

  const next = applyVerdict(await deps.loadState(agentId), verdict);
  await deps.saveState(agentId, next);
  return next;
}

export const liveReviewDeps: ReviewDeps = {
  async loadState(agentId) {
    const { data, error } = await supabase
      .from("agents").select("level, max_level, streak, recent_verdicts")
      .eq("id", agentId).single();
    if (error) throw new Error(error.message);
    return {
      level: data.level,
      maxLevel: data.max_level,
      streak: data.streak,
      recent: data.recent_verdicts as Verdict[],
    };
  },
  async saveState(agentId, s) {
    const { error } = await supabase.from("agents")
      .update({ level: s.level, streak: s.streak, recent_verdicts: s.recent })
      .eq("id", agentId);
    if (error) throw new Error(error.message);
  },
  async setDraftStatus(draftId, status) {
    const { error } = await supabase.from("drafts")
      .update({ status }).eq("id", draftId);
    if (error) throw new Error(error.message);
  },
  async insertApproval(draftId, verdict, reason) {
    const { error } = await supabase.from("approvals")
      .insert({ draft_id: draftId, verdict, reason: reason ?? null });
    if (error) throw new Error(error.message);
  },
  async insertFeedback(agentId, reason) {
    const { error } = await supabase.from("feedback")
      .insert({ agent_id: agentId, reason });
    if (error) throw new Error(error.message);
  },
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/review.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write `src/cli.ts`**

```ts
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { supabase } from "./db.js";
import { recordVerdict, liveReviewDeps, countRules, MAX_RULES } from "./review.js";
import type { Verdict } from "./types.js";

const rl = readline.createInterface({ input: stdin, output: stdout });

async function main(): Promise<void> {
  const { data, error } = await supabase
    .from("drafts")
    .select("id, agent_id, body, created_at, agents(display_name, level)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const drafts = data ?? [];
  if (drafts.length === 0) {
    console.log("\nNothing waiting on you.\n");
    rl.close();
    return;
  }

  console.log(`\n${drafts.length} draft(s) waiting.\n`);

  for (const d of drafts) {
    const agent = d.agents as unknown as { display_name: string; level: number };
    console.log("─".repeat(64));
    console.log(`${agent.display_name}  ·  level ${agent.level}`);
    console.log("─".repeat(64));
    console.log(`\n${d.body}\n`);

    const answer = (await rl.question("[a]pprove  [e]dited  [d]ecline  [s]kip > "))
      .trim().toLowerCase();

    if (answer === "s" || answer === "") continue;

    const verdict: Verdict | null =
      answer === "a" ? "approved" :
      answer === "e" ? "approved_with_edit" :
      answer === "d" ? "declined" : null;

    if (!verdict) {
      console.log("Not a valid choice. Skipping this draft.\n");
      continue;
    }

    let reason: string | undefined;
    if (verdict === "declined") {
      reason = (await rl.question("One line — what was wrong? > ")).trim();
      if (!reason) {
        console.log("A decline needs a reason, or the agent learns nothing. Skipping.\n");
        continue;
      }
    }

    const next = await recordVerdict(liveReviewDeps, d.id, d.agent_id, verdict, reason);
    console.log(`Recorded. ${agent.display_name} is now level ${next.level}, streak ${next.streak}.`);

    // The instruction cap is what stops an agent's working memory turning into
    // Attune's old CLAUDE.md: corrections appended forever, nothing removed.
    if (verdict === "declined") {
      const { data: a } = await supabase
        .from("agents").select("instructions").eq("id", d.agent_id).single();
      const rules = countRules(a?.instructions ?? "");
      if (rules >= MAX_RULES) {
        console.log(
          `\n  ${agent.display_name} is at ${rules} rules (cap ${MAX_RULES}). ` +
          `Consolidate before adding more: merge duplicates and drop rules not ` +
          `violated in 30 days. The full history stays in the feedback table.`,
        );
      }
    }
    console.log("");
  }

  rl.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: Commit**

```bash
git add src/review.ts src/cli.ts tests/review.test.ts
git commit -m "feat: review CLI recording verdicts and moving agents on the ladder"
```

---

### Task 9: Seed the three agents and run it end to end

**Files:**
- Create: `src/seed.ts`
- Create: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: three agent rows (`strategist`, `writer`, `chief_of_staff`) and the first live drafts.

- [ ] **Step 1: Write `src/seed.ts`**

```ts
import { supabase } from "./db.js";

const AGENTS = [
  {
    key: "strategist",
    display_name: "Strategist",
    department: "Growth",
    turn_cap: 12,
    instructions: [
      "You are the Strategist for Denis's businesses.",
      "You pick angles. You never write finished posts — that is the Writer's job.",
      "Use the divergence skill. Reject your own first ideas and reframe until",
      "the angles are ones only this business could publish.",
      "Never fabricate a client story, a testimonial or a statistic.",
      "Never describe any Attune coach as AI.",
      "Use no dashes of any kind in output copy.",
    ].join("\n"),
  },
  {
    key: "writer",
    display_name: "Writer",
    department: "Growth",
    turn_cap: 8,
    instructions: [
      "You are the Writer for Denis's businesses.",
      "Write in Denis's voice, following the my-content skill.",
      "Output the post text only. No preamble, no options, no commentary.",
      "Never fabricate a client story, a testimonial or a statistic.",
      "Never describe any Attune coach as AI.",
      "Use no dashes of any kind in output copy.",
    ].join("\n"),
  },
  {
    key: "chief_of_staff",
    display_name: "Chief of Staff",
    department: "Office",
    turn_cap: 6,
    instructions: [
      "You are Denis's Chief of Staff.",
      "You assemble the morning brief and route requests. You do no work yourself.",
      "If nothing ran overnight, say so explicitly. Never return an empty brief —",
      "silence must never be ambiguous between 'nothing was due' and 'the worker died'.",
      "Keep the brief under 150 words.",
    ].join("\n"),
  },
];

async function main(): Promise<void> {
  for (const a of AGENTS) {
    const { error } = await supabase
      .from("agents").upsert(a, { onConflict: "key" });
    if (error) throw new Error(`seeding ${a.key} failed: ${error.message}`);
    console.log(`seeded ${a.key}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Seed and verify**

Run: `npm run seed`
Expected: three `seeded ...` lines.

Verify in the Supabase SQL editor: `select key, level, streak from agents;`
Expected: three rows, every `level` = 1, every `streak` = 0.

- [ ] **Step 3: Queue one task and dry-run it**

In the SQL editor:

```sql
insert into tasks (agent_id, kind)
select id, 'daily_draft' from agents where key = 'writer';
```

Run: `npm run worker -- --dry-run`
Expected: `[worker] produced (dry run)` then `[worker] idle`.

Verify: `select count(*) from drafts_dryrun;` returns 1, and `select count(*) from drafts;` returns 0. **If a row landed in `drafts`, stop — dry-run routing is broken and must be fixed before any live run.**

- [ ] **Step 4: Run it live**

```sql
insert into tasks (agent_id, kind)
select id, 'daily_draft' from agents where key = 'writer';
```

Run: `npm run worker`
Expected: `[worker] produced` then `[worker] idle`.

- [ ] **Step 5: Review the draft**

Run: `npm run review`

Expected: the draft prints with the agent name and level, and the prompt `[a]pprove  [e]dited  [d]ecline  [s]kip`. Choose one. On approve, expect `Writer is now level 1, streak 1.`

- [ ] **Step 6: Prove backpressure against the live system**

Queue four tasks at once:

```sql
insert into tasks (agent_id, kind)
select a.id, 'daily_draft'
  from agents a, generate_series(1, 4)
 where a.key = 'writer';
```

Run: `npm run worker`

Expected: three `produced`, then `skipped_at_capacity`, then `idle`. Verify `select count(*) from drafts where status = 'pending';` returns 3, never 4.

- [ ] **Step 7: Write `README.md`**

```markdown
# agentco

Agents that do the work while Denis approves, and need less approval over time.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the Supabase URL and service role key.
3. Apply `supabase/migrations/0001_init.sql` in the Supabase SQL editor.
4. `npm run seed`

## Daily use

- `npm run worker` — drains every due task, then exits. Run it from cron.
- `npm run worker -- --dry-run` — same, but writes to `drafts_dryrun` and nothing real.
- `npm run review` — walk the pending drafts and approve, edit or decline.

## The rules

Agents start at level 1 and draft only. Five approvals with no edit promotes;
two declines in the last five demotes; approving after an edit resets the streak
without changing the level. An agent stops producing at three pending drafts, so
review capacity throttles the system rather than a backlog building up.

## Tests

`npm test` — ladder, backpressure, output assertion, worker loop and review logic
run with no database and no model calls. `tests/db.test.ts` needs a live `.env`.
```

- [ ] **Step 8: Full verification and commit**

Run: `npm test`
Expected: all suites pass.

Run: `npm run typecheck`
Expected: no output, exit 0.

```bash
git add -A
git commit -m "feat: seed the three v1 agents and document the runbook"
```

---

## After this plan

The engine works and Denis reviews from the terminal. Two follow-ups, each its own plan:

1. **Scheduling** — cron entries that queue `weekly_angles` on Mondays and `daily_draft` plus `brief` each morning. Deliberately left out here so the pipeline is proven by hand first.
2. **The dashboard** — the Next.js approval queue from the spec. Build it once the drafts are known to be worth approving.

**The acceptance test still stands:** in two weeks, has content gone out that Denis did not write? If the drafts are not good enough to approve, no amount of interface fixes that.
