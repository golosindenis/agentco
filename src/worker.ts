import { canProduce } from "./capacity.js";
import { assertUsableOutput } from "./output.js";
import { TASK_PROMPTS } from "./prompts.js";
import type { AgentRow, TaskRow } from "./types.js";
import type { RunResult } from "./runner.js";
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
  runAgent: typeof runAgent;
};

/**
 * src/db.ts throws at import time when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 * are absent (by design). Building `liveDeps` as a top-level const would import
 * db.ts as soon as anything imports this module — including tests that only
 * want `processOne` and never touch the database. So `liveDeps` is built lazily
 * here, via a dynamic import, and only ever called from `main()`.
 */
async function buildLiveDeps(): Promise<WorkerDeps> {
  const db = await import("./db.js");
  return {
    claimNextTask: db.claimNextTask,
    getAgent: db.getAgent,
    countPendingDrafts: db.countPendingDrafts,
    latestDraftBody: db.latestDraftBody,
    insertDraft: db.insertDraft,
    finishTask: db.finishTask,
    logEvent: db.logEvent,
    runAgent,
  };
}

export async function processOne(
  deps: WorkerDeps, dryRun: boolean,
): Promise<WorkerOutcome> {
  const task = await deps.claimNextTask();
  if (!task) return "idle";

  try {
    const agent = await deps.getAgent(task.agent_id);

    const pending = await deps.countPendingDrafts(agent.id);
    if (!canProduce(pending)) {
      // A capacity skip marks the task "done", not "failed" or requeued. These
      // are recurring scheduled tasks: tomorrow's run creates a fresh occurrence
      // regardless. Requeuing a skipped occurrence would just rebuild the same
      // backlog that this capacity check exists to prevent, so the occurrence
      // is dropped on purpose.
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
  } catch (err) {
    // A claimed task flips its row to "running" and nothing else ever reclaims
    // it (claim_next_task() only selects "queued" rows) — so any unhandled
    // throw here (e.g. a transient network blip against Supabase) would leave
    // the row running forever. Catch everything past the claim and force the
    // task to a terminal, human-visible state instead. finishTask/logEvent can
    // themselves throw (that's how we got here), so guard them too — a failure
    // while recording the failure must not mask the original error.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] task ${task.id} crashed:`, err);
    try {
      await deps.finishTask(task.id, "failed", message);
    } catch (finishErr) {
      console.error(`[worker] finishTask itself threw while recording the failure for ${task.id}:`, finishErr);
    }
    try {
      await deps.logEvent("run_crashed", { error: message }, task.agent_id, task.id);
    } catch (logErr) {
      console.error(`[worker] logEvent itself threw while recording the crash for ${task.id}:`, logErr);
    }
    return "failed";
  }
}

/** Drains every due task, then exits. Cron runs this; it is not a daemon. */
export async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const liveDeps = await buildLiveDeps();
  for (;;) {
    const outcome = await processOne(liveDeps, dryRun);
    console.log(`[worker] ${outcome}${dryRun ? " (dry run)" : ""}`);
    if (outcome === "idle") break;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
