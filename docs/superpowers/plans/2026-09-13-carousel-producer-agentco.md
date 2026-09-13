# Carousel Producer (Plan 1 of 2: agentco) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Denis taps "Make carousel" on an approved daily draft and a validated carousel deck lands in a new `carousels` table, visible on the draft page.

**Architecture:** A new `carousel` task kind carries `source_draft_id`. The worker routes it to a Producer agent, validates the output with a pure `parseDeck`, and writes `carousels` (never `drafts`, no backpressure, no ladder). The web app gets a server action and a status panel. Plan 2 (builder fork: hosted editor, login, Send, images on phone) consumes the `carousels` rows this plan creates.

**Tech Stack:** TypeScript, Node (tsx), Vitest, Supabase (Postgres + supabase-js), Next.js 16 web app.

Spec: `docs/superpowers/specs/2026-09-13-carousel-producer-design.md`.

## Global Constraints

- Never run `npm run seed`. Agent rows change through migrations only.
- Migrations are applied to Supabase project `kaniwythbumchzokzyas`.
- New tables: RLS enabled, no anon/authenticated access; only service role reads and writes.
- Deck slide types allowed: `hook body cta quote list stats comparison`. 5 to 10 slides. First `hook`, last `cta`.
- No `-`, `–` or `—` anywhere in deck strings.
- Watermark: subjects `attune` and `denis` → `@becoming_denis`; `agentco` → `@becomingdenis`.
- `carousel` is not added to `POSTABLE_KINDS`. Carousel tasks skip backpressure and never touch the ladder.
- Every web mutation calls `requireAuthorizedUser()` first.
- Run from `~/agentco`: `npm test` and `npm run typecheck`; from `~/agentco/web`: `npm run typecheck`.

---

### Task 1: Schema, types, Producer agent

**Files:**
- Create: `supabase/migrations/0003_carousels.sql`
- Modify: `src/types.ts`
- Modify: `src/prompts.ts`

**Interfaces:**
- Produces: `TaskKind` includes `"carousel"`; `TaskRow.source_draft_id: string | null`; `CarouselRow` type; `TASK_PROMPTS.carousel`; table `carousels`; agent row `producer`.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0003_carousels.sql`:

```sql
-- Carousel Producer (docs/superpowers/specs/2026-09-13-carousel-producer-design.md).
-- A carousel task points at the approved draft it is made from. Decks live in
-- their own table, like briefs: the source draft was already approved, and a
-- deck is not something to approve or decline, so it never enters `drafts`,
-- never counts toward backpressure and never moves the ladder.
alter table tasks add column source_draft_id uuid references drafts(id) on delete cascade;

create table carousels (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid references tasks(id) on delete set null,
  source_draft_id uuid not null references drafts(id) on delete cascade,
  slides          jsonb not null,
  watermark       text not null,
  status          text not null default 'deck_ready' check (status in ('deck_ready','sent')),
  look            text,
  settings        jsonb,
  image_paths     text[],
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index carousels_source_idx on carousels (source_draft_id, created_at desc);

alter table carousels enable row level security;
revoke all on table carousels from public, anon, authenticated;
grant all on table carousels to service_role;

insert into agents (key, display_name, department, turn_cap, instructions)
values (
  'producer', 'Producer', 'Marketing', 6,
  $$You are the Producer for Denis's businesses.
You turn one approved post into a carousel deck for Denis's carousel builder.
Output a JSON array of slides and nothing else. No preamble, no code fence commentary.
Each slide is an object. Allowed "type" values: hook, body, cta, quote, list, stats, comparison.
The first slide is a hook, the last is a cta. Use 5 to 10 slides.
Allowed fields: type, text, subtext, italics (array of phrases), highlight, title, author, role, stats ([{value,label}]), items (array), leftLabel, leftItems, rightLabel, rightItems.
Every italics phrase and highlight must appear word for word in that slide's text.
Keep the approved post's own wording. Cut it down; do not rewrite it.
Never fabricate an anecdote, a client story, a testimonial or a statistic.
Never describe any Attune coach as AI.
Use no dashes of any kind: no hyphen, en dash or em dash anywhere.
Quiet editorial copy. No emoji, badges or stickers.
Pattern to follow, from a real deck:
[{"type":"hook","text":"Every fitness plan gives a woman two choices on a bad day","italics":["two choices"],"subtext":"Neither of them is a good one."},
 {"type":"body","text":"Choice one. Follow it exactly.","italics":["Follow it exactly."],"subtext":"Even though you slept four hours and today already feels heavy."},
 {"type":"cta","text":"That is the whole reason I am building Attune.","italics":["building Attune"],"subtext":"Building Attune in public. Day by day."}]$$
)
on conflict (key) do nothing;
```

- [ ] **Step 2: Update types**

In `src/types.ts` replace the `TaskKind` line and the `TaskRow` type, and append `CarouselRow`:

```ts
export type TaskKind = "weekly_angles" | "daily_draft" | "brief" | "wholesale_outreach" | "carousel";
```

```ts
export type TaskRow = {
  id: string;
  agent_id: string;
  kind: TaskKind;
  state: TaskState;
  due_at: string;
  error: string | null;
  /** Set only on `carousel` tasks: the approved draft the deck is made from. */
  source_draft_id?: string | null;
};
```

```ts
export type CarouselRow = {
  id: string;
  task_id: string | null;
  source_draft_id: string;
  slides: unknown[];
  watermark: string;
  status: "deck_ready" | "sent";
  look: string | null;
  settings: Record<string, unknown> | null;
  image_paths: string[] | null;
  created_at: string;
  sent_at: string | null;
};
```

- [ ] **Step 3: Add the task prompt**

In `src/prompts.ts`, add inside `TASK_PROMPTS` after `wholesale_outreach`:

```ts
  carousel:
    "Turn the approved post below into one carousel deck. Output only the JSON array of slides.",
```

- [ ] **Step 4: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: no type errors; all existing tests pass.

- [ ] **Step 5: Apply the migration**

Apply `0003_carousels.sql` to project `kaniwythbumchzokzyas` (Supabase MCP `apply_migration`, name `carousels`). Then verify:

```sql
select key, turn_cap, can_publish from agents where key = 'producer';
select column_name from information_schema.columns where table_name = 'tasks' and column_name = 'source_draft_id';
select has_table_privilege('anon', 'public.carousels', 'select') as anon_can_read;
```

Expected: one `producer` row (turn_cap 6, can_publish false); one `source_draft_id` row; `anon_can_read` false.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0003_carousels.sql src/types.ts src/prompts.ts
git commit -m "feat(carousel): schema, carousel task kind and Producer agent"
```

---

### Task 2: `parseDeck`

**Files:**
- Create: `src/deck.ts`
- Test: `tests/deck.test.ts`

**Interfaces:**
- Produces: `parseDeck(body: string): DeckResult` where `type DeckResult = { ok: true; slides: DeckSlide[] } | { ok: false; reason: string }` and `type DeckSlide = Record<string, unknown> & { type: string }`.

- [ ] **Step 1: Write the failing tests**

`tests/deck.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseDeck } from "../src/deck.js";

const hook = { type: "hook", text: "Every fitness plan gives a woman two choices on a bad day", italics: ["two choices"], subtext: "Neither of them is a good one." };
const body = (text: string) => ({ type: "body", text, subtext: "A supporting sentence." });
const cta = { type: "cta", text: "That is the whole reason I am building Attune.", italics: ["building Attune"] };
const deck = (slides: unknown[]) => JSON.stringify(slides);
const valid = [hook, body("One"), body("Two"), body("Three"), cta];

describe("parseDeck", () => {
  it("accepts a valid deck", () => {
    const r = parseDeck(deck(valid));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.slides).toHaveLength(5);
  });

  it("accepts a deck wrapped in a json code fence", () => {
    expect(parseDeck("```json\n" + deck(valid) + "\n```").ok).toBe(true);
  });

  it("rejects non JSON", () => {
    expect(parseDeck("Here is your deck")).toEqual({ ok: false, reason: "output is not valid JSON" });
  });

  it("rejects a non array", () => {
    expect(parseDeck(JSON.stringify({ slides: valid }))).toEqual({ ok: false, reason: "deck must be a JSON array of slides" });
  });

  it("rejects fewer than 5 slides", () => {
    expect(parseDeck(deck([hook, body("One"), cta]))).toEqual({ ok: false, reason: "deck has 3 slides; needs 5 to 10" });
  });

  it("rejects more than 10 slides", () => {
    const many = [hook, ...Array.from({ length: 9 }, (_, i) => body(`Slide ${i}`)), cta];
    expect(parseDeck(deck(many))).toEqual({ ok: false, reason: "deck has 11 slides; needs 5 to 10" });
  });

  it("rejects a first slide that is not a hook", () => {
    expect(parseDeck(deck([body("Zero"), ...valid.slice(1)]))).toEqual({ ok: false, reason: "slide 1 must be a hook" });
  });

  it("rejects a last slide that is not a cta", () => {
    expect(parseDeck(deck([...valid.slice(0, 4), body("End")]))).toEqual({ ok: false, reason: "slide 5 must be a cta" });
  });

  it("rejects a disallowed type", () => {
    const d = [hook, body("One"), { type: "emoji", emoji: "x" }, body("Three"), cta];
    expect(parseDeck(deck(d))).toEqual({ ok: false, reason: "slide 3 has disallowed type emoji" });
  });

  it("rejects an unknown field", () => {
    const d = [hook, body("One"), { ...body("Two"), stickers: [] }, body("Three"), cta];
    expect(parseDeck(deck(d))).toEqual({ ok: false, reason: "slide 3 has unknown field stickers" });
  });

  it("rejects an italics phrase missing from the text", () => {
    const d = [hook, body("One"), { ...body("Two"), italics: ["three"] }, body("Three"), cta];
    expect(parseDeck(deck(d))).toEqual({ ok: false, reason: 'slide 3 italics phrase "three" is not in its text' });
  });

  it("matches italics case insensitively", () => {
    const d = [hook, body("One"), { ...body("Two words"), italics: ["TWO"] }, body("Three"), cta];
    expect(parseDeck(deck(d)).ok).toBe(true);
  });

  it("rejects a highlight missing from the text", () => {
    const d = [hook, body("One"), { ...body("Two"), highlight: "nope" }, body("Three"), cta];
    expect(parseDeck(deck(d))).toEqual({ ok: false, reason: 'slide 3 highlight "nope" is not in its text' });
  });

  it.each(["-", "–", "—"])("rejects the dash %s anywhere, including nested fields", (dash) => {
    const d = [hook, body("One"), { type: "list", text: "List", items: ["fine", `bad ${dash} item`] }, body("Three"), cta];
    expect(parseDeck(deck(d))).toEqual({ ok: false, reason: "slide 3 contains a dash" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/deck.test.ts`
Expected: FAIL, cannot resolve `../src/deck.js`.

- [ ] **Step 3: Implement**

`src/deck.ts`:

```ts
/**
 * Validates the Producer's output before anything is saved. The builder
 * renders whatever it is given, so a deck that breaks Denis's rules (a dash,
 * an italic phrase that is not in the line, a sticker slide) would only be
 * discovered in the editor. Every rule here comes from the carousel producer
 * spec; a rejection names the slide and the rule so the failed task says
 * exactly what to fix.
 */

export type DeckSlide = Record<string, unknown> & { type: string };
export type DeckResult = { ok: true; slides: DeckSlide[] } | { ok: false; reason: string };

const ALLOWED_TYPES = new Set(["hook", "body", "cta", "quote", "list", "stats", "comparison"]);

/** Fields of the builder's SlideData that a text only agent can fill. */
const ALLOWED_FIELDS = new Set([
  "type", "text", "subtext", "subHighlight", "italics", "title", "highlight",
  "author", "role", "stats", "items", "steps", "leftLabel", "leftItems",
  "rightLabel", "rightItems", "points", "label",
]);

const DASH = /[-–—]/;

function stripFence(body: string): string {
  const m = body.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  return m ? m[1]! : body.trim();
}

function hasDash(value: unknown): boolean {
  if (typeof value === "string") return DASH.test(value);
  if (Array.isArray(value)) return value.some(hasDash);
  if (value && typeof value === "object") return Object.values(value).some(hasDash);
  return false;
}

export function parseDeck(body: string): DeckResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(body));
  } catch {
    return { ok: false, reason: "output is not valid JSON" };
  }
  if (!Array.isArray(parsed)) return { ok: false, reason: "deck must be a JSON array of slides" };
  const n = parsed.length;
  if (n < 5 || n > 10) return { ok: false, reason: `deck has ${n} slides; needs 5 to 10` };

  for (let i = 0; i < n; i++) {
    const s = parsed[i] as Record<string, unknown> | null;
    const at = `slide ${i + 1}`;
    if (!s || typeof s !== "object" || Array.isArray(s)) return { ok: false, reason: `${at} is not an object` };
    const type = String(s.type ?? "");
    if (i === 0 && type !== "hook") return { ok: false, reason: `${at} must be a hook` };
    if (i === n - 1 && type !== "cta") return { ok: false, reason: `${at} must be a cta` };
    if (!ALLOWED_TYPES.has(type)) return { ok: false, reason: `${at} has disallowed type ${type}` };
    for (const key of Object.keys(s)) {
      if (!ALLOWED_FIELDS.has(key)) return { ok: false, reason: `${at} has unknown field ${key}` };
    }
    const text = typeof s.text === "string" ? s.text.toLowerCase() : "";
    if (Array.isArray(s.italics)) {
      for (const phrase of s.italics) {
        if (typeof phrase !== "string" || !text.includes(phrase.toLowerCase())) {
          return { ok: false, reason: `${at} italics phrase "${String(phrase)}" is not in its text` };
        }
      }
    }
    if (typeof s.highlight === "string" && !text.includes(s.highlight.toLowerCase())) {
      return { ok: false, reason: `${at} highlight "${s.highlight}" is not in its text` };
    }
    if (hasDash(s)) return { ok: false, reason: `${at} contains a dash` };
  }
  return { ok: true, slides: parsed as DeckSlide[] };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/deck.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/deck.ts tests/deck.test.ts
git commit -m "feat(carousel): parseDeck validates Producer output"
```

---

### Task 3: Watermark by subject

**Files:**
- Modify: `src/subjects.ts` (append)
- Test: `tests/subjects.test.ts` (append)

**Interfaces:**
- Consumes: `SubjectKey`, `subjectFor(date: Date): SubjectKey`.
- Produces: `watermarkFor(key: SubjectKey): string`.

- [ ] **Step 1: Write the failing test** (append to `tests/subjects.test.ts`; add `watermarkFor` to its existing import from `../src/subjects.js`)

```ts
describe("watermarkFor", () => {
  it("uses the Instagram handle for Attune and personal posts", () => {
    expect(watermarkFor("attune")).toBe("@becoming_denis");
    expect(watermarkFor("denis")).toBe("@becoming_denis");
  });
  it("uses the X handle for agentco posts", () => {
    expect(watermarkFor("agentco")).toBe("@becomingdenis");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/subjects.test.ts`
Expected: FAIL, `watermarkFor` is not exported.

- [ ] **Step 3: Implement** (append to `src/subjects.ts`)

```ts
/**
 * The handle stamped on a carousel. Attune and personal carousels go to
 * Instagram (@becoming_denis, as every existing deck uses); agentco build in
 * public goes to X, where the handle is @becomingdenis.
 */
export function watermarkFor(key: SubjectKey): string {
  return key === "agentco" ? "@becomingdenis" : "@becoming_denis";
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/subjects.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/subjects.ts tests/subjects.test.ts
git commit -m "feat(carousel): watermark chosen by subject"
```

---

### Task 4: Worker `carousel` path

**Files:**
- Modify: `src/db.ts` (append two functions)
- Modify: `src/worker.ts`
- Test: `tests/worker.test.ts`

**Interfaces:**
- Consumes: `parseDeck` (Task 2), `watermarkFor`, `subjectFor`, `SUBJECTS` (Task 3), `TaskRow.source_draft_id` (Task 1).
- Produces: `WorkerDeps.getSourceDraft(id: string): Promise<SourceDraft | null>`, `WorkerDeps.insertCarousel(row: NewCarousel): Promise<void>`, where
  `type SourceDraft = { body: string; status: string; kind: string; created_at: string }` and
  `type NewCarousel = { taskId: string; sourceDraftId: string; slides: unknown[]; watermark: string }`, both exported from `src/db.ts`.

- [ ] **Step 1: Write the failing tests**

In `tests/worker.test.ts`, add to the `deps` factory defaults (after `gatherBriefFacts`):

```ts
  getSourceDraft: vi.fn(async () => ({
    body: "Every fitness plan gives a woman two choices on a bad day.",
    status: "approved", kind: "daily_draft", created_at: "2026-09-14T08:00:00.000Z",
  })),
  insertCarousel: vi.fn(async () => {}),
```

Append inside `describe("processOne", ...)`:

```ts
  const carouselTask = { ...task, kind: "carousel", source_draft_id: "d9" };
  const validDeck = JSON.stringify([
    { type: "hook", text: "Two choices on a bad day", italics: ["Two choices"] },
    { type: "body", text: "Choice one" },
    { type: "body", text: "Choice two" },
    { type: "body", text: "A third choice" },
    { type: "cta", text: "Building Attune" },
  ]);
  // A factory, not one shared mock: call history would otherwise leak between tests.
  const deckRun = () => vi.fn(async (): Promise<RunResult> => ({ ok: true, body: validDeck, usage: defaultUsage }));

  it("writes a carousel, not a draft, with the source post in the prompt", async () => {
    const d = deps({ claimNextTask: vi.fn(async () => carouselTask), runAgent: deckRun() });
    expect(await processOne(d, false)).toBe("produced");
    const prompt = (d.runAgent as any).mock.calls[0][1] as string;
    expect(prompt).toContain("Every fitness plan gives a woman two choices on a bad day.");
    expect(d.insertDraft).not.toHaveBeenCalled();
    expect(d.insertCarousel).toHaveBeenCalledWith({
      taskId: "t1", sourceDraftId: "d9",
      slides: JSON.parse(validDeck), watermark: "@becoming_denis",
    });
    expect(d.finishTask).toHaveBeenCalledWith("t1", "done");
  });

  it("does not apply backpressure to a carousel", async () => {
    const d = deps({ claimNextTask: vi.fn(async () => carouselTask), runAgent: deckRun(), countPendingDrafts: vi.fn(async () => 3) });
    expect(await processOne(d, false)).toBe("produced");
    expect(d.countPendingDrafts).not.toHaveBeenCalled();
  });

  it("fails a carousel whose source draft is missing, without running the agent", async () => {
    const d = deps({ claimNextTask: vi.fn(async () => carouselTask), getSourceDraft: vi.fn(async () => null) });
    expect(await processOne(d, false)).toBe("failed");
    expect(d.runAgent).not.toHaveBeenCalled();
    expect(d.finishTask).toHaveBeenCalledWith("t1", "failed", "source draft d9 not found");
  });

  it("fails a carousel whose source draft is not an approved daily_draft", async () => {
    const d = deps({
      claimNextTask: vi.fn(async () => carouselTask),
      getSourceDraft: vi.fn(async () => ({ body: "x", status: "pending", kind: "daily_draft", created_at: "2026-09-14T08:00:00.000Z" })),
    });
    expect(await processOne(d, false)).toBe("failed");
    expect(d.finishTask).toHaveBeenCalledWith("t1", "failed", "source draft d9 is not an approved daily_draft");
  });

  it("fails a carousel with no source_draft_id", async () => {
    const d = deps({ claimNextTask: vi.fn(async () => ({ ...carouselTask, source_draft_id: null })) });
    expect(await processOne(d, false)).toBe("failed");
    expect(d.finishTask).toHaveBeenCalledWith("t1", "failed", "carousel task has no source_draft_id");
  });

  it("rejects an invalid deck and saves nothing", async () => {
    const d = deps({ claimNextTask: vi.fn(async () => carouselTask) });
    expect(await processOne(d, false)).toBe("failed");
    expect(d.insertCarousel).not.toHaveBeenCalled();
    expect(d.logEvent).toHaveBeenCalledWith("output_rejected", { reason: "output is not valid JSON" }, "a1", "t1");
    expect(d.finishTask).toHaveBeenCalledWith("t1", "failed", "output is not valid JSON");
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/worker.test.ts`
Expected: FAIL (type errors on unknown deps keys, and the carousel tests fail).

- [ ] **Step 3: Add the database functions** (append to `src/db.ts`)

```ts
export type SourceDraft = { body: string; status: string; kind: string; created_at: string };
export type NewCarousel = { taskId: string; sourceDraftId: string; slides: unknown[]; watermark: string };

/** The draft a carousel is made from, with its task kind, or null. */
export async function getSourceDraft(id: string): Promise<SourceDraft | null> {
  const { data, error } = await supabase
    .from("drafts")
    .select("body, status, created_at, tasks(kind)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getSourceDraft(${id}): ${error.message}`);
  if (!data) return null;
  const row = data as any;
  return { body: row.body, status: row.status, kind: row.tasks?.kind ?? "", created_at: row.created_at };
}

export async function insertCarousel(c: NewCarousel): Promise<void> {
  const { error } = await supabase.from("carousels").insert({
    task_id: c.taskId, source_draft_id: c.sourceDraftId, slides: c.slides, watermark: c.watermark,
  });
  if (error) throw new Error(`insertCarousel failed: ${error.message}`);
}
```

- [ ] **Step 4: Wire the worker**

In `src/worker.ts`:

Add imports:

```ts
import { parseDeck } from "./deck.js";
import { SUBJECTS, subjectFor, bankHasSubject, watermarkFor } from "./subjects.js";
import type { BriefFacts, NewCarousel, SourceDraft } from "./db.js";
```

(replacing the existing `subjects.js` and `db.js` type imports).

Add to `WorkerDeps`:

```ts
  getSourceDraft: (id: string) => Promise<SourceDraft | null>;
  insertCarousel: (row: NewCarousel) => Promise<void>;
```

Add to `buildLiveDeps` return:

```ts
    getSourceDraft: db.getSourceDraft,
    insertCarousel: db.insertCarousel,
```

Add this function above `processOne`:

```ts
/**
 * A carousel is made on request from a draft Denis already approved, so it
 * has none of the daily machinery: no backpressure (it is not awaiting a
 * verdict), no identical-output guard, and it writes `carousels`, never
 * `drafts`, so it can never move the ladder. `markWritten` lets processOne's
 * catch report a bookkeeping failure after the insert as produced, exactly
 * as it does for drafts.
 */
async function produceCarousel(
  deps: WorkerDeps, task: TaskRow, agent: AgentRow, markWritten: () => void,
): Promise<WorkerOutcome> {
  const fail = async (reason: string, event: string) => {
    await deps.logEvent(event, { reason }, agent.id, task.id);
    await deps.finishTask(task.id, "failed", reason);
    return "failed" as const;
  };

  if (!task.source_draft_id) return fail("carousel task has no source_draft_id", "no_source_draft");
  const source = await deps.getSourceDraft(task.source_draft_id);
  if (!source) return fail(`source draft ${task.source_draft_id} not found`, "no_source_draft");
  if (source.status !== "approved" || source.kind !== "daily_draft") {
    return fail(`source draft ${task.source_draft_id} is not an approved daily_draft`, "no_source_draft");
  }

  // The subject is the one the post was written for: the rota day it was created.
  const subjectKey = subjectFor(new Date(source.created_at));
  const prompt =
    `${TASK_PROMPTS.carousel}\n\n## Subject: ${SUBJECTS[subjectKey].label}\n\n${SUBJECTS[subjectKey].voice}` +
    `\n\n## Approved post\n\n${source.body}`;

  const run = await deps.runAgent(agent, prompt);
  if (!run.ok) return fail(run.reason, "run_failed");

  const deck = parseDeck(run.body);
  if (!deck.ok) return fail(deck.reason, "output_rejected");

  await deps.insertCarousel({
    taskId: task.id, sourceDraftId: task.source_draft_id,
    slides: deck.slides, watermark: watermarkFor(subjectKey),
  });
  markWritten();
  await deps.logEvent("carousel_created", {
    slides: deck.slides.length,
    costUsd: run.usage.costUsd,
    inputTokens: run.usage.inputTokens,
    outputTokens: run.usage.outputTokens,
    durationMs: run.usage.durationMs,
    model: run.usage.model,
  }, agent.id, task.id);
  await deps.finishTask(task.id, "done");
  return "produced";
}
```

In `processOne`, immediately after the `if (!agent.enabled) { ... }` block, add:

```ts
    if (task.kind === "carousel") {
      return await produceCarousel(deps, task, agent, () => { draftWritten = true; });
    }
```

Note the failure event names in the tests: the missing-source and invalid-deck tests assert `finishTask` reasons, and the invalid-deck test asserts `logEvent("output_rejected", { reason }, "a1", "t1")`, matching `fail` above.

- [ ] **Step 5: Run to verify pass**

Run: `npm test && npm run typecheck`
Expected: all tests pass, including the 6 new worker tests; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/db.ts src/worker.ts tests/worker.test.ts
git commit -m "feat(carousel): worker produces validated decks into carousels"
```

---

### Task 5: "Make carousel" in the web app

**Files:**
- Create: `src/carousel.ts`
- Test: `tests/carousel.test.ts`
- Modify: `src/db.ts` (append)
- Modify: `web/app/actions.ts` (append action, extend import)
- Create: `web/app/drafts/[id]/CarouselPanel.tsx`
- Modify: `web/app/drafts/[id]/page.tsx`

**Interfaces:**
- Consumes: `CarouselRow`, `TaskState` (Task 1); `getAgentByKey(key): Promise<AgentRow | null>` and `getDraftForReview(id)` (existing, `src/db.ts`).
- Produces: `carouselView(task, carousel, editorUrl): CarouselView`; `queueCarouselTask(draftId: string): Promise<void>`; `carouselStatusForDraft(draftId: string): Promise<{ task: CarouselTaskState | null; carousel: CarouselRow | null }>`; server action `requestCarousel(formData): Promise<ActionResult>`.

- [ ] **Step 1: Write the failing test**

`tests/carousel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { carouselView } from "../src/carousel.js";

const carousel = { id: "c1", status: "deck_ready", slides: [{}, {}, {}, {}, {}], created_at: "2026-09-14T09:00:00.000Z" } as any;

describe("carouselView", () => {
  it("offers the button when nothing was ever requested", () => {
    expect(carouselView(null, null, "")).toEqual({ state: "none" });
  });
  it("says it is waiting for the Mac while the task is queued or running", () => {
    expect(carouselView({ state: "queued", error: null, created_at: "2026-09-14T08:00:00.000Z" }, null, "")).toEqual({ state: "waiting" });
    expect(carouselView({ state: "running", error: null, created_at: "2026-09-14T08:00:00.000Z" }, null, "")).toEqual({ state: "waiting" });
  });
  it("shows the failure reason when the latest task failed", () => {
    expect(carouselView({ state: "failed", error: "slide 2 contains a dash", created_at: "2026-09-14T10:00:00.000Z" }, carousel, ""))
      .toEqual({ state: "failed", reason: "slide 2 contains a dash" });
  });
  it("shows the deck with an editor link when configured", () => {
    expect(carouselView({ state: "done", error: null, created_at: "2026-09-14T08:00:00.000Z" }, carousel, "https://editor.example"))
      .toEqual({ state: "deck_ready", slideCount: 5, editorHref: "https://editor.example/c/c1" });
  });
  it("omits the editor link until the editor is hosted", () => {
    expect(carouselView({ state: "done", error: null, created_at: "2026-09-14T08:00:00.000Z" }, carousel, ""))
      .toEqual({ state: "deck_ready", slideCount: 5, editorHref: null });
  });
  it("reports sent carousels", () => {
    expect(carouselView({ state: "done", error: null, created_at: "2026-09-14T08:00:00.000Z" }, { ...carousel, status: "sent" }, ""))
      .toEqual({ state: "sent", slideCount: 5 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/carousel.test.ts`
Expected: FAIL, cannot resolve `../src/carousel.js`.

- [ ] **Step 3: Implement the view model**

`src/carousel.ts`:

```ts
import type { CarouselRow, TaskState } from "./types.js";

export type CarouselTaskState = { state: TaskState; error: string | null; created_at: string };

export type CarouselView =
  | { state: "none" }
  | { state: "waiting" }
  | { state: "failed"; reason: string }
  | { state: "deck_ready"; slideCount: number; editorHref: string | null }
  | { state: "sent"; slideCount: number };

/**
 * What the draft page shows about its carousel, from the newest carousel task
 * and the newest carousel row. The task wins when it is newer than the deck:
 * a retry that is queued or failed must not be hidden behind an older deck.
 * `editorUrl` is empty until Plan 2 hosts the editor.
 */
export function carouselView(
  task: CarouselTaskState | null, carousel: CarouselRow | null, editorUrl: string,
): CarouselView {
  if (task && (task.state === "queued" || task.state === "running")) return { state: "waiting" };
  if (task && task.state === "failed" && (!carousel || task.created_at > carousel.created_at)) {
    return { state: "failed", reason: task.error ?? "unknown error" };
  }
  if (!carousel) return { state: "none" };
  const slideCount = carousel.slides.length;
  if (carousel.status === "sent") return { state: "sent", slideCount };
  const base = editorUrl.replace(/\/$/, "");
  return { state: "deck_ready", slideCount, editorHref: base ? `${base}/c/${carousel.id}` : null };
}
```

Note the failed test passes a carousel created at 09:00 and a failed task at 10:00, so the newer failure wins.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/carousel.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add database functions** (append to `src/db.ts`; add `CarouselRow` to the `./types.js` import and `import type { CarouselTaskState } from "./carousel.js";`)

```ts
/** Queues a Producer run for an approved draft. Refuses while one is in flight. */
export async function queueCarouselTask(draftId: string): Promise<void> {
  const producer = await getAgentByKey("producer");
  if (!producer) throw new Error("Producer agent is missing; apply migration 0003.");
  const { count, error: countErr } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("source_draft_id", draftId)
    .eq("kind", "carousel")
    .in("state", ["queued", "running"]);
  if (countErr) throw new Error(`queueCarouselTask count failed: ${countErr.message}`);
  if ((count ?? 0) > 0) throw new Error("A carousel for this draft is already on its way.");
  const { error } = await supabase
    .from("tasks")
    .insert({ agent_id: producer.id, kind: "carousel", source_draft_id: draftId });
  if (error) throw new Error(`queueCarouselTask failed: ${error.message}`);
}

/** The newest carousel task and newest carousel for one draft. */
export async function carouselStatusForDraft(draftId: string): Promise<{
  task: CarouselTaskState | null; carousel: CarouselRow | null;
}> {
  const [t, c] = await Promise.all([
    supabase.from("tasks").select("state, error, created_at")
      .eq("source_draft_id", draftId).eq("kind", "carousel")
      .order("created_at", { ascending: false }).limit(1),
    supabase.from("carousels").select("*")
      .eq("source_draft_id", draftId)
      .order("created_at", { ascending: false }).limit(1),
  ]);
  if (t.error) throw new Error(`carouselStatusForDraft tasks: ${t.error.message}`);
  if (c.error) throw new Error(`carouselStatusForDraft carousels: ${c.error.message}`);
  return {
    task: (t.data?.[0] as CarouselTaskState | undefined) ?? null,
    carousel: (c.data?.[0] as CarouselRow | undefined) ?? null,
  };
}
```

- [ ] **Step 6: Add the server action** (append to `web/app/actions.ts`; extend the `../../src/db.js` import with `queueCarouselTask`)

```ts
/**
 * Queues the Producer for one approved daily draft. Only approved
 * daily_drafts can become carousels (spec), and the Mac worker picks the
 * task up on its next run.
 */
export async function requestCarousel(formData: FormData): Promise<ActionResult> {
  const unauthorized = await requireAuthorizedUser();
  if (unauthorized) return unauthorized;

  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "Missing draft id." };
  try {
    const draft = await getDraftForReview(draftId);
    if (!draft) return { ok: false, error: "This draft no longer exists." };
    if (draft.status !== "approved" || draft.kind !== "daily_draft") {
      return { ok: false, error: "Only approved daily posts can become carousels." };
    }
    await queueCarouselTask(draftId);
    revalidatePath(`/drafts/${draftId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 7: Create the panel**

`web/app/drafts/[id]/CarouselPanel.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { requestCarousel, type ActionResult } from "../../actions";
import type { CarouselView } from "../../../../src/carousel.js";

const initial: ActionResult = { ok: true };

export function CarouselPanel({ draftId, view }: { draftId: string; view: CarouselView }) {
  const [result, action, pending] = useActionState(async () => {
    const fd = new FormData();
    fd.set("draftId", draftId);
    return requestCarousel(fd);
  }, initial);

  const button = (label: string) => (
    <form action={action}>
      <button type="submit" className="primary" disabled={pending}>
        {pending ? "Queuing…" : label}
      </button>
      {result.ok === false && <span className="hint"> {result.error}</span>}
    </form>
  );

  return (
    <section className="note-band">
      {view.state === "none" && button("Make carousel")}
      {view.state === "waiting" && <p>Carousel queued. Waiting for your Mac.</p>}
      {view.state === "failed" && (
        <>
          <p>Carousel failed: {view.reason}</p>
          {button("Try again")}
        </>
      )}
      {view.state === "deck_ready" && (
        <p>
          Carousel ready, {view.slideCount} slides.{" "}
          {view.editorHref ? <a href={view.editorHref}>Open editor</a> : "Editor not hosted yet."}
        </p>
      )}
      {view.state === "sent" && <p>Carousel sent, {view.slideCount} slides.</p>}
    </section>
  );
}
```

- [ ] **Step 8: Render it on the draft page**

In `web/app/drafts/[id]/page.tsx`:

Add imports:

```tsx
import { carouselStatusForDraft } from "../../../../src/db.js";
import { carouselView } from "../../../../src/carousel.js";
import { CarouselPanel } from "./CarouselPanel";
```

(merge `carouselStatusForDraft` into the existing `src/db.js` import line).

After `if (!draft) notFound();` add:

```tsx
  const canCarousel = draft.status === "approved" && draft.kind === "daily_draft";
  const carousel = canCarousel ? await carouselStatusForDraft(draft.id) : null;
```

Replace the final `) : (<p className="note-band">Already {draft.status}.</p>)}` branch with:

```tsx
      ) : (
        <>
          <p className="note-band">Already {draft.status}.</p>
          {carousel && (
            <CarouselPanel
              draftId={draft.id}
              view={carouselView(carousel.task, carousel.carousel, process.env.CAROUSEL_EDITOR_URL ?? "")}
            />
          )}
        </>
      )}
```

- [ ] **Step 9: Verify**

Run: `cd ~/agentco && npm test && npm run typecheck && cd web && npm run typecheck && npm run build`
Expected: all tests pass; both typechecks clean; `next build` succeeds.

- [ ] **Step 10: Commit**

```bash
git add src/carousel.ts tests/carousel.test.ts src/db.ts web/app/actions.ts "web/app/drafts/[id]/CarouselPanel.tsx" "web/app/drafts/[id]/page.tsx"
git commit -m "feat(carousel): Make carousel button and status on the draft page"
```

---

### Task 6: Prove it on production

**Files:** none (verification only). Append a dated entry to `docs/build-log.md` in Step 5.

- [ ] **Step 1: Push and confirm the deploy**

```bash
git push
```

Expected: Vercel builds `agentco` and the deployment is Ready (check with the Vercel MCP `list_deployments`).

- [ ] **Step 2: Queue from the phone**

On the live app, open an approved daily draft and tap **Make carousel**. Expected: the panel shows "Carousel queued. Waiting for your Mac." Verify:

```sql
select id, state, source_draft_id from tasks where kind = 'carousel' order by created_at desc limit 1;
```

Expected: one `queued` row with `source_draft_id` set.

- [ ] **Step 3: Run the worker**

```bash
cd ~/agentco && npm run worker
```

Expected: `[worker] produced`, then `[worker] idle`.

- [ ] **Step 4: Check the deck**

```sql
select status, watermark, jsonb_array_length(slides) as n, slides->0->>'type' as first, slides->(jsonb_array_length(slides)-1)->>'type' as last
from carousels order by created_at desc limit 1;
```

Expected: `deck_ready`, the watermark for that draft's subject, `n` between 5 and 10, `first` = `hook`, `last` = `cta`. Reload the draft page: it shows "Carousel ready, N slides. Editor not hosted yet." Read the slide text and confirm it keeps the post's wording and contains no dashes.

- [ ] **Step 5: Record it**

Append to `docs/build-log.md` a dated section: what shipped, the production verification above, and that Plan 2 (hosted editor) is next. Commit and push:

```bash
git add docs/build-log.md
git commit -m "docs: carousel producer plan 1 verified on production"
git push
```
