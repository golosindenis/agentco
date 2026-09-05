/**
 * Pure aggregation for the cost/usage report. No network, no clock reads
 * beyond the `now` passed to `totalsByDay` — kept separate from
 * scripts/costs.ts's Supabase fetch so this arithmetic is unit-testable.
 */

export type RunEvent = {
  agent: string;
  createdAt: string; // ISO
  costUsd: number | null; // null when the run predates telemetry
  outputTokens: number | null;
};

export type AgentTotals = {
  agent: string;
  runs: number;
  costedRuns: number;
  totalCostUsd: number;
  avgCostUsd: number | null; // null when costedRuns is 0
  outputTokens: number;
};

/**
 * Per-agent totals, sorted by total cost descending so the expensive agent
 * is the first thing read.
 *
 * Runs that predate telemetry (costUsd/outputTokens both null) count toward
 * `runs` but not `costedRuns` — averaging over `runs` would understate the
 * average the more uncosted history an agent has. `avgCostUsd` is null
 * rather than 0 when there is nothing costed to average, since an uncosted
 * run is missing data, not a free one.
 */
export function totalsByAgent(events: RunEvent[]): AgentTotals[] {
  const byAgent = new Map<string, AgentTotals>();

  for (const e of events) {
    const t = byAgent.get(e.agent) ?? {
      agent: e.agent,
      runs: 0,
      costedRuns: 0,
      totalCostUsd: 0,
      avgCostUsd: null,
      outputTokens: 0,
    };
    t.runs += 1;
    if (e.costUsd !== null) {
      t.costedRuns += 1;
      t.totalCostUsd += e.costUsd;
    }
    if (e.outputTokens !== null) {
      t.outputTokens += e.outputTokens;
    }
    byAgent.set(e.agent, t);
  }

  const totals = [...byAgent.values()];
  for (const t of totals) {
    t.avgCostUsd = t.costedRuns > 0 ? t.totalCostUsd / t.costedRuns : null;
  }

  return totals.sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}

/** Local calendar-day key (YYYY-MM-DD), consistent with src/schedule.ts's
 * use of Date#getDay() rather than its UTC equivalent. */
function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Runs grouped by local calendar day, most recent day first, restricted to
 * the trailing `days`-day window ending on `now`'s local day. Days with no
 * runs are omitted entirely — a 14-day window with one active day should
 * read as one row, not thirteen rows of zeros.
 */
export function totalsByDay(
  events: RunEvent[], days: number, now: Date,
): { date: string; runs: number; totalCostUsd: number }[] {
  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  windowStart.setDate(windowStart.getDate() - (days - 1));

  const byDay = new Map<string, { date: string; runs: number; totalCostUsd: number }>();

  for (const e of events) {
    const createdAt = new Date(e.createdAt);
    const dayStart = new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate());
    if (dayStart < windowStart) continue;

    const key = localDayKey(createdAt);
    const stats = byDay.get(key) ?? { date: key, runs: 0, totalCostUsd: 0 };
    stats.runs += 1;
    if (e.costUsd !== null) stats.totalCostUsd += e.costUsd;
    byDay.set(key, stats);
  }

  return [...byDay.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
