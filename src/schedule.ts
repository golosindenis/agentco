import type { TaskKind } from "./types.js";

export type ScheduledTask = { agentKey: string; kind: TaskKind };

/**
 * What should be queued for the given calendar day, using the date's local
 * day-of-week (`Date#getDay`, not UTC). Every day gets the writer's daily
 * draft and the chief of staff's brief; Mondays additionally get the
 * strategist's weekly angles, and Fridays the Writer's wholesale outreach
 * for The Solution.
 *
 * Order is stable and deterministic: weekly work first, then daily work, so
 * a Monday's angles are queued (and, once the Writer reads its approved
 * output, available) ahead of that day's draft.
 */
export function dueOn(date: Date): ScheduledTask[] {
  const tasks: ScheduledTask[] = [];

  const isMonday = date.getDay() === 1;
  if (isMonday) {
    tasks.push({ agentKey: "strategist", kind: "weekly_angles" });
  }

  // The Solution's work is outbound, not audience content, so it gets its own
  // weekly task rather than a slot in the daily-draft rota. Friday, so a reply
  // can land before the weekend rather than during it.
  const isFriday = date.getDay() === 5;
  if (isFriday) {
    tasks.push({ agentKey: "writer", kind: "wholesale_outreach" });
  }

  tasks.push({ agentKey: "writer", kind: "daily_draft" });
  tasks.push({ agentKey: "chief_of_staff", kind: "brief" });

  return tasks;
}
