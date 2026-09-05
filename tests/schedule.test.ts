import { describe, it, expect } from "vitest";
import { dueOn } from "../src/schedule.js";

// Construct local dates explicitly and assert getDay() so a timezone slip in
// the test itself is caught rather than silently passing.
const MONDAY = new Date(2026, 8, 7); // 2026-09-07
const TUESDAY = new Date(2026, 8, 8); // 2026-09-08
const SUNDAY = new Date(2026, 8, 6); // 2026-09-06 (the week boundary)

describe("dueOn", () => {
  it("sanity-checks the fixture dates against their intended weekday", () => {
    expect(MONDAY.getDay()).toBe(1);
    expect(TUESDAY.getDay()).toBe(2);
    expect(SUNDAY.getDay()).toBe(0);
  });

  it("returns three tasks on Monday, including weekly_angles for the strategist", () => {
    const tasks = dueOn(MONDAY);
    expect(tasks).toHaveLength(3);
    expect(tasks).toContainEqual({ agentKey: "strategist", kind: "weekly_angles" });
  });

  it("returns exactly two tasks on Tuesday, with no weekly_angles", () => {
    const tasks = dueOn(TUESDAY);
    expect(tasks).toHaveLength(2);
    expect(tasks.some((t) => t.kind === "weekly_angles")).toBe(false);
  });

  it("returns the writer's daily_draft and the chief of staff's brief every day", () => {
    for (const date of [MONDAY, TUESDAY, SUNDAY]) {
      const tasks = dueOn(date);
      expect(tasks).toContainEqual({ agentKey: "writer", kind: "daily_draft" });
      expect(tasks).toContainEqual({ agentKey: "chief_of_staff", kind: "brief" });
    }
  });

  it("orders Monday's weekly_angles ahead of that day's daily_draft", () => {
    const tasks = dueOn(MONDAY);
    const anglesIndex = tasks.findIndex((t) => t.kind === "weekly_angles");
    const draftIndex = tasks.findIndex((t) => t.kind === "daily_draft");
    expect(anglesIndex).toBeGreaterThanOrEqual(0);
    expect(draftIndex).toBeGreaterThanOrEqual(0);
    expect(anglesIndex).toBeLessThan(draftIndex);
  });

  it("returns exactly two tasks on Sunday, the week boundary, with no weekly_angles", () => {
    const tasks = dueOn(SUNDAY);
    expect(tasks).toHaveLength(2);
    expect(tasks.some((t) => t.kind === "weekly_angles")).toBe(false);
  });
});
