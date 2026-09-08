import type { AgentRow } from "../../../src/types.js";
import type { HealthState } from "../../../src/health.js";

/** Shared between TodayView's health pill and OverviewView's health banner
 * so the two surfaces never drift on what a given state is called. */
export const HEALTH_LABEL: Record<HealthState, string> = {
  healthy: "Healthy",
  nothing_ran_today: "Nothing ran today",
  something_failed: "Something failed",
};

/**
 * Marketing sorts first because it is where the work Denis actually reviews
 * comes from; everything else is alphabetical so adding a department never
 * reshuffles the ones above it.
 */
const FIRST_DEPARTMENT = "Marketing";

export function groupByDepartment(
  agents: AgentRow[],
): { department: string; agents: AgentRow[] }[] {
  const byDept = new Map<string, AgentRow[]>();
  for (const a of agents) {
    const list = byDept.get(a.department) ?? [];
    list.push(a);
    byDept.set(a.department, list);
  }
  return [...byDept.entries()]
    .map(([department, list]) => ({ department, agents: list }))
    .sort((x, y) => {
      if (x.department === FIRST_DEPARTMENT) return -1;
      if (y.department === FIRST_DEPARTMENT) return 1;
      return x.department.localeCompare(y.department);
    });
}

/** First `lines` lines of a draft, with an ellipsis when anything was cut. */
export function truncateLines(body: string, lines: number): string {
  if (!body) return "";
  const all = body.split("\n");
  if (all.length <= lines) return body;
  return all.slice(0, lines).join("\n") + "…";
}
