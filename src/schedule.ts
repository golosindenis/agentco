import type { TaskKind } from "./types.js";

export type ScheduledTask = { agentKey: string; kind: TaskKind };

/**
 * What should be queued for the given calendar day, using the date's local
 * day-of-week (`Date#getDay`, not UTC). Every day gets the writer's daily
 * draft and the chief of staff's brief; Mondays additionally get the
 * strategist's weekly angles.
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

  tasks.push({ agentKey: "writer", kind: "daily_draft" });
  tasks.push({ agentKey: "chief_of_staff", kind: "brief" });

  return tasks;
}
