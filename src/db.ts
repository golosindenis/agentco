import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import type { AgentRow, TaskKind, TaskRow } from "./types.js";
import { POSTABLE_KINDS } from "./types.js";

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

/**
 * A dry run's output must never mix with real drafts (see the `drafts_dryrun`
 * comment in the migration) — and that has to hold for every read as well as
 * the write. `insertDraft` alone switching tables on `dryRun` while these two
 * still always read `drafts` would mean a dry run computes backpressure from
 * real pending drafts and compares its own output against real ones: it
 * would never actually exercise the dry-run path it exists to test. All
 * three go through this one helper so they can't drift apart again.
 */
function table(dryRun: boolean): "drafts" | "drafts_dryrun" {
  return dryRun ? "drafts_dryrun" : "drafts";
}

export async function countPendingDrafts(agentId: string, dryRun: boolean): Promise<number> {
  const { count, error } = await supabase
    .from(table(dryRun))
    .select("id", { count: "exact", head: true })
    .eq("agent_id", agentId)
    .eq("status", "pending");
  if (error) throw new Error(`countPendingDrafts failed: ${error.message}`);
  return count ?? 0;
}

export async function latestDraftBody(agentId: string, dryRun: boolean): Promise<string | null> {
  const { data, error } = await supabase
    .from(table(dryRun))
    .select("body")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`latestDraftBody failed: ${error.message}`);
  return data?.[0]?.body ?? null;
}

/**
 * The body of the most recently created draft whose task has the given kind
 * and whose status is 'approved', or null if there is none.
 *
 * drafts.task_id is a single (to-one) FK to tasks, so this is written as one
 * embedded select — `tasks!inner(kind)` — rather than a two-step query: the
 * `!inner` makes it an inner join, so filtering on the embedded `tasks.kind`
 * column also filters which `drafts` rows come back, in one round trip.
 */
export async function latestApprovedDraftBody(kind: TaskKind): Promise<string | null> {
  const { data, error } = await supabase
    .from("drafts")
    .select("body, tasks!inner(kind)")
    .eq("tasks.kind", kind)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`latestApprovedDraftBody failed: ${error.message}`);
  return data?.[0]?.body ?? null;
}

export async function insertDraft(
  taskId: string, agentId: string, body: string, dryRun: boolean,
): Promise<void> {
  const { error } = await supabase
    .from(table(dryRun))
    .insert({ task_id: taskId, agent_id: agentId, body });
  if (error) throw new Error(`insertDraft failed: ${error.message}`);
}

/**
 * `briefsTable` mirrors `table` above for the same reason: a dry-run brief
 * must never land in the real `briefs` table, so the write has to switch
 * tables on `dryRun` exactly like `insertDraft` does. The brief has no
 * `status` and never enters the approval queue (see the migration comment),
 * so unlike `drafts` there is no read here that also needs to branch on
 * `dryRun` — `latestBrief` below is only ever used to show Denis the real
 * brief, never the dry-run scratch copy.
 */
function briefsTable(dryRun: boolean): "briefs" | "briefs_dryrun" {
  return dryRun ? "briefs_dryrun" : "briefs";
}

export async function insertBrief(
  agentId: string, body: string, dryRun: boolean,
): Promise<void> {
  const { error } = await supabase
    .from(briefsTable(dryRun))
    .insert({ agent_id: agentId, body });
  if (error) throw new Error(`insertBrief failed: ${error.message}`);
}

/** The most recent real brief, for the CLI to show Denis as information —
 * never as something to approve. Always reads `briefs`, never
 * `briefs_dryrun`: a dry run's output is scratch, not something Denis
 * should ever be shown as his actual morning brief. */
export async function latestBrief(): Promise<{ body: string; created_at: string } | null> {
  const { data, error } = await supabase
    .from("briefs")
    .select("body, created_at")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`latestBrief failed: ${error.message}`);
  return data?.[0] ?? null;
}

/**
 * Approved drafts Denis has not yet posted by hand, oldest first — so the
 * queue drains in the order it was written, the way a to-do list should.
 * Nothing in this system publishes (see the README): this is the read side
 * of the last mile, letting `scripts/drafts.ts` show Denis the text he
 * approved so he can paste it somewhere himself.
 *
 * Restricted to `POSTABLE_KINDS`: an approved draft's task kind must be one
 * Denis actually posts. Without this, a weekly_angles draft — approved only
 * so the Writer can read it as input, never something Denis pastes anywhere
 * — would sit in this queue forever, since it is approved and never gets a
 * `posted_at`. `drafts.task_id` is a single (to-one) FK to tasks, so this
 * filter is the same embedded-select join `latestApprovedDraftBody` above
 * uses — `tasks!inner(kind)` — combined here with the existing
 * `agents(display_name)` join (`drafts.agent_id` is also to-one) in one
 * round trip.
 */
export async function approvedUnpostedDrafts(): Promise<
  { id: string; agent: string; body: string; createdAt: string }[]
> {
  const { data, error } = await supabase
    .from("drafts")
    .select("id, body, created_at, agents(display_name), tasks!inner(kind)")
    .eq("status", "approved")
    .is("posted_at", null)
    .in("tasks.kind", POSTABLE_KINDS)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`approvedUnpostedDrafts failed: ${error.message}`);

  return ((data ?? []) as unknown as
    { id: string; body: string; created_at: string; agents: { display_name: string } | null }[]
  ).map((row) => ({
    id: row.id,
    agent: row.agents?.display_name ?? "unknown",
    body: row.body,
    createdAt: row.created_at,
  }));
}

/** Marks a draft posted — Denis pasted it somewhere himself and it should
 * drop out of `approvedUnpostedDrafts`'s queue. */
export async function markPosted(draftId: string): Promise<void> {
  const { error } = await supabase
    .from("drafts")
    .update({ posted_at: new Date().toISOString() })
    .eq("id", draftId);
  if (error) throw new Error(`markPosted failed: ${error.message}`);
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

export type BriefFacts = {
  since: string;
  tasksByState: Record<string, number>;
  failures: { agent: string; kind: string; error: string }[];
  draftsCreated: number;
  pendingByAgent: { agent: string; pending: number }[];
};

/**
 * Raw material for the morning brief, over the trailing 24 hours: task
 * outcomes, failures, drafts written, and what is currently waiting on Denis
 * per agent. `runAgent` hands the brief agent nothing but its instructions
 * and the task prompt (see worker.ts) — it cannot query anything itself — so
 * this is the only source of real numbers it has. Its own seeded
 * instructions say never to fabricate; without this, a bare prompt and a
 * turn cap is a recipe for it inventing the brief instead.
 */
export async function gatherBriefFacts(): Promise<BriefFacts> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: recentTasks, error: tasksErr } = await supabase
    .from("tasks")
    .select("state")
    .gte("created_at", since);
  if (tasksErr) throw new Error(`gatherBriefFacts (tasks) failed: ${tasksErr.message}`);
  const tasksByState: Record<string, number> = {};
  for (const row of (recentTasks ?? []) as { state: string }[]) {
    tasksByState[row.state] = (tasksByState[row.state] ?? 0) + 1;
  }

  const { data: failedTasks, error: failuresErr } = await supabase
    .from("tasks")
    .select("kind, error, agents(display_name)")
    .eq("state", "failed")
    .gte("finished_at", since);
  if (failuresErr) throw new Error(`gatherBriefFacts (failures) failed: ${failuresErr.message}`);
  const failures = ((failedTasks ?? []) as unknown as
    { kind: string; error: string | null; agents: { display_name: string } | null }[]
  ).map((row) => ({
    agent: row.agents?.display_name ?? "unknown",
    kind: row.kind,
    error: row.error ?? "",
  }));

  const { count: draftsCreated, error: draftsErr } = await supabase
    .from("drafts")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if (draftsErr) throw new Error(`gatherBriefFacts (drafts) failed: ${draftsErr.message}`);

  const { data: pendingDrafts, error: pendingErr } = await supabase
    .from("drafts")
    .select("agent_id, agents(display_name)")
    .eq("status", "pending");
  if (pendingErr) throw new Error(`gatherBriefFacts (pending) failed: ${pendingErr.message}`);
  const pendingCounts = new Map<string, { agent: string; pending: number }>();
  for (const row of (pendingDrafts ?? []) as unknown as
    { agent_id: string; agents: { display_name: string } | null }[]
  ) {
    const existing = pendingCounts.get(row.agent_id);
    if (existing) {
      existing.pending += 1;
    } else {
      pendingCounts.set(row.agent_id, { agent: row.agents?.display_name ?? "unknown", pending: 1 });
    }
  }

  return {
    since,
    tasksByState,
    failures,
    draftsCreated: draftsCreated ?? 0,
    pendingByAgent: [...pendingCounts.values()],
  };
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
