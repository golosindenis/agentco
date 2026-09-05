import { canProduce } from "./capacity.js";
import { assertUsableOutput } from "./output.js";
import { TASK_PROMPTS } from "./prompts.js";
import type { AgentRow, TaskKind, TaskRow } from "./types.js";
import type { RunResult } from "./runner.js";
import { runAgent } from "./runner.js";
import type { BriefFacts } from "./db.js";

export type WorkerOutcome =
  | "idle" | "produced" | "skipped_at_capacity" | "skipped_disabled" | "failed";

export type WorkerDeps = {
  claimNextTask: () => Promise<TaskRow | null>;
  getAgent: (id: string) => Promise<AgentRow>;
  countPendingDrafts: (agentId: string, dryRun: boolean) => Promise<number>;
  latestDraftBody: (agentId: string, dryRun: boolean) => Promise<string | null>;
  latestApprovedDraftBody: (kind: TaskKind) => Promise<string | null>;
  insertDraft: (taskId: string, agentId: string, body: string, dryRun: boolean) => Promise<void>;
  insertBrief: (agentId: string, body: string, dryRun: boolean) => Promise<void>;
  finishTask: (id: string, state: "done" | "failed", error?: string) => Promise<void>;
  logEvent: (kind: string, detail: Record<string, unknown>, agentId?: string, taskId?: string) => Promise<void>;
  gatherBriefFacts: () => Promise<BriefFacts>;
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
    latestApprovedDraftBody: db.latestApprovedDraftBody,
    insertDraft: db.insertDraft,
    insertBrief: db.insertBrief,
    finishTask: db.finishTask,
    logEvent: db.logEvent,
    gatherBriefFacts: db.gatherBriefFacts,
    runAgent,
  };
}

/** Converts a caught value to a string for logging/recording, defensively:
 * stringifying the value itself (a hostile toString()/Symbol.toPrimitive)
 * can throw, and this helper's whole job is to never let that happen. */
function errorToMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return "unstringifiable error";
  }
}

export async function processOne(
  deps: WorkerDeps, dryRun: boolean,
): Promise<WorkerOutcome> {
  const task = await deps.claimNextTask();
  if (!task) return "idle";

  let draftWritten = false;
  try {
    const agent = await deps.getAgent(task.agent_id);

    if (!agent.enabled) {
      // enabled is the kill switch: with no check here, disabling an agent
      // in the schema does nothing at all — the worker keeps claiming its
      // tasks and keeps spawning `claude` for it. The task itself did
      // nothing wrong, so it's finished "done" rather than "failed".
      await deps.logEvent("skipped_disabled", {}, agent.id, task.id);
      await deps.finishTask(task.id, "done");
      return "skipped_disabled";
    }

    const isBrief = task.kind === "brief";

    // The backpressure cap throttles on drafts awaiting Denis's verdict — the
    // brief never enters that queue (see the migration and gatherBriefFacts'
    // doc comment), so it is not pending work and must never be blocked by
    // it. Skipping the check entirely, rather than just exempting `brief`
    // from `canProduce`'s result, also means an unread brief can never
    // itself count toward some other kind's cap and can never be starved by
    // a full one: the two are on completely separate queues.
    if (!isBrief) {
      const pending = await deps.countPendingDrafts(agent.id, dryRun);
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
    }

    let taskPrompt = TASK_PROMPTS[task.kind];
    if (task.kind === "daily_draft") {
      // The Writer's whole prompt is agent.instructions + "---" + taskPrompt
      // (see runAgent) — nothing else reaches the model. Without the actual
      // approved angle bank appended here, the Writer just invents its own
      // angle every run, making the Strategist/approval step in front of it
      // pointless. A missing angle bank is a real condition to surface, not
      // something to paper over with a generic post.
      const angleBank = await deps.latestApprovedDraftBody("weekly_angles");
      if (angleBank === null) {
        const reason = "no approved weekly_angles draft for the Writer to draw from";
        await deps.logEvent("no_angle_bank", { reason }, agent.id, task.id);
        await deps.finishTask(task.id, "failed", reason);
        return "failed";
      }
      taskPrompt = `${taskPrompt}\n\n## Approved angle bank\n\n${angleBank}`;
    }
    if (isBrief) {
      // The brief has nothing to draw on besides its own instructions and
      // this bare task prompt (see runAgent) — it cannot query anything
      // itself. Its own seeded instructions say never to fabricate, so
      // without real numbers here it is stuck between inventing the brief
      // and returning nothing useful. gatherBriefFacts is its only source
      // of ground truth.
      const facts = await deps.gatherBriefFacts();
      taskPrompt = `${taskPrompt}\n\n## Facts gathered from the last 24 hours\n\n${JSON.stringify(facts, null, 2)}`;
    }

    const run = await deps.runAgent(agent, taskPrompt);
    if (!run.ok) {
      await deps.logEvent("run_failed", { reason: run.reason }, agent.id, task.id);
      await deps.finishTask(task.id, "failed", run.reason);
      return "failed";
    }

    // The identical-output guard below exists to catch a run that quietly
    // did nothing new. For the morning brief that comparison is actively
    // wrong: a quiet night legitimately produces the same
    // "Nothing ran overnight." text two mornings running, and the brief must
    // always render — a silent morning must never be ambiguous between
    // "nothing was due" and "the worker died". So a brief task is never
    // compared against its previous output; the empty and too-short checks
    // in assertUsableOutput still apply to it.
    const previous = isBrief ? null : await deps.latestDraftBody(agent.id, dryRun);
    const check = assertUsableOutput(run.body, previous);
    if (!check.ok) {
      await deps.logEvent("output_rejected", { reason: check.reason }, agent.id, task.id);
      await deps.finishTask(task.id, "failed", check.reason);
      return "failed";
    }

    // The brief is read-only and never enters the approval queue drafts sit
    // in (see the migration comment on `briefs`), so it is written through
    // its own `insertBrief` path rather than `insertDraft` — landing it in
    // `drafts` here would put it right back in front of Denis for a verdict,
    // which is exactly what this table split exists to prevent.
    if (isBrief) {
      await deps.insertBrief(agent.id, run.body, dryRun);
    } else {
      await deps.insertDraft(task.id, agent.id, run.body, dryRun);
    }
    draftWritten = true;
    await deps.logEvent(
      isBrief ? "brief_created" : "draft_created",
      {
        chars: run.body.length,
        dryRun,
        // List-price-equivalent cost/usage telemetry from the run (see
        // RunUsage in runner.ts) — makes an expensive agent visible in
        // `events` instead of a surprise. Not a bill: costBasis is "list".
        costUsd: run.usage.costUsd,
        inputTokens: run.usage.inputTokens,
        outputTokens: run.usage.outputTokens,
        cacheReadTokens: run.usage.cacheReadTokens,
        cacheCreationTokens: run.usage.cacheCreationTokens,
        durationMs: run.usage.durationMs,
        numTurns: run.usage.numTurns,
        model: run.usage.model,
      },
      agent.id, task.id,
    );
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
    const message = errorToMessage(err);

    if (draftWritten) {
      // The agent's actual work already succeeded — insertDraft/insertBrief
      // landed a real, reviewable draft (or a read-only brief) in the table.
      // Only bookkeeping after that point threw, so this is not a failure:
      // report it as produced, and log the bookkeeping error loudly rather
      // than letting it recolor the outcome.
      console.error(
        `[worker] task ${task.id} produced a draft successfully, but recording it crashed ` +
        `(draft already exists, this is a bookkeeping-only failure):`, err,
      );
      try {
        await deps.finishTask(task.id, "done");
      } catch (finishErr) {
        console.error(`[worker] finishTask("done") itself threw while recording success for ${task.id} — the row is stuck "running" even though a draft exists:`, finishErr);
      }
      return "produced";
    }

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
