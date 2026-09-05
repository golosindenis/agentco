import type { TaskKind, TaskState } from "./types.js";

/**
 * Pure health-state derivation for the dashboard's "did it run?" banner.
 *
 * No network, no clock reads beyond the `now` passed in — kept separate from
 * src/db.ts's fetch (see `getHealthFacts`) so this decision is unit-testable
 * with explicit timestamps, the same split costs.ts and schedule.ts use.
 *
 * The whole point of this module is to make a silent morning distinguishable
 * from a broken one. "Nothing happened" and "something is wrong" must never
 * collapse into the same on-screen state.
 */

/** A task row still in "running" longer than this is stuck, not merely slow.
 * RUN_TIMEOUT_MS in runner.ts kills a spawned agent at 10 minutes and the
 * worker's own catch-all then finishes the task row — so a row still
 * "running" well past that point means the process (or the whole worker)
 * died without ever reaching that cleanup, not that the agent is thinking
 * hard. Set comfortably above the 10-minute run timeout so a run that is
 * merely close to its own limit is never misreported as stuck. */
export const STUCK_RUNNING_THRESHOLD_MS = 15 * 60 * 1000;

export type HealthTask = {
  kind: TaskKind;
  state: TaskState;
  createdAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  agent: string;
};

export type HealthFacts = {
  /** Tasks with created_at on or after the start of today, local calendar day. */
  tasksToday: HealthTask[];
  /** Every task currently in state "running", regardless of day — the pool
   * stuck detection is checked against. */
  runningTasks: HealthTask[];
  /** Tasks that reached state "failed" within the lookback window (see
   * `getHealthFacts`), most recent first. */
  recentFailedTasks: HealthTask[];
  /** The most recent finished_at across every task ever, done or failed —
   * "when the worker last completed anything" — or null if nothing ever has. */
  lastCompletedAt: string | null;
};

export type HealthState = "healthy" | "nothing_ran_today" | "something_failed";

export type HealthResult = {
  state: HealthState;
  headline: string;
  /** Evidence lines: timestamps and counts backing the headline, shown
   * beside it so the state is never asserted without proof. */
  evidence: string[];
};

function minutesAgo(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
}

function describeToday(tasks: HealthTask[]): string {
  const counts: Record<string, number> = {};
  for (const t of tasks) counts[t.state] = (counts[t.state] ?? 0) + 1;
  const parts = Object.entries(counts).map(([state, n]) => `${n} ${state}`);
  return `${tasks.length} task(s) today (${parts.join(", ")})`;
}

/**
 * Derives the one on-screen health state from raw facts.
 *
 * Priority order, most urgent first:
 *   1. something_failed — a stuck "running" row, or a task that actually
 *      failed recently. Either is a real problem to look at right now, and
 *      that holds even on a day nothing new has been queued yet.
 *   2. nothing_ran_today — no evidence of trouble, but also no evidence
 *      today's schedule ever ran or finished. This is the ambiguous case the
 *      whole system exists to resolve: a quiet morning is not a broken one,
 *      but it must never look identical to a healthy one either.
 *   3. healthy — today produced at least one finished (done or failed) task
 *      and nothing above fired.
 */
export function deriveHealth(facts: HealthFacts, now: Date): HealthResult {
  const stuck = facts.runningTasks.filter(
    (t) => t.claimedAt !== null && now.getTime() - new Date(t.claimedAt).getTime() > STUCK_RUNNING_THRESHOLD_MS,
  );

  const evidence: string[] = [];

  if (stuck.length > 0 || facts.recentFailedTasks.length > 0) {
    for (const t of stuck) {
      evidence.push(
        `${t.agent}'s ${t.kind} has been "running" for ${minutesAgo(t.claimedAt!, now)} min (claimed ${t.claimedAt})`,
      );
    }
    for (const t of facts.recentFailedTasks) {
      const when = t.finishedAt ?? t.createdAt;
      evidence.push(`${t.agent}'s ${t.kind} failed ${minutesAgo(when, now)} min ago${t.error ? `: ${t.error}` : ""}`);
    }

    const headline =
      stuck.length > 0 && facts.recentFailedTasks.length > 0
        ? `${stuck.length} task(s) stuck running, ${facts.recentFailedTasks.length} failed recently.`
        : stuck.length > 0
          ? `${stuck.length} task(s) stuck in "running".`
          : `${facts.recentFailedTasks.length} task(s) failed recently.`;

    return { state: "something_failed", headline, evidence };
  }

  const finishedToday = facts.tasksToday.filter((t) => t.state === "done" || t.state === "failed");
  if (finishedToday.length === 0) {
    evidence.push(
      facts.tasksToday.length > 0
        ? describeToday(facts.tasksToday) + " — none finished yet"
        : "No tasks queued today yet",
    );
    evidence.push(
      facts.lastCompletedAt
        ? `Last completed run: ${facts.lastCompletedAt} (${minutesAgo(facts.lastCompletedAt, now)} min ago)`
        : "No run has ever completed",
    );
    return { state: "nothing_ran_today", headline: "Nothing ran today yet.", evidence };
  }

  evidence.push(describeToday(facts.tasksToday));
  if (facts.lastCompletedAt) {
    evidence.push(`Last completed: ${facts.lastCompletedAt} (${minutesAgo(facts.lastCompletedAt, now)} min ago)`);
  }
  return { state: "healthy", headline: "This morning's run went through clean.", evidence };
}
