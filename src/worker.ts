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
