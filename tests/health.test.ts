import { describe, it, expect } from "vitest";
import { deriveHealth, STUCK_RUNNING_THRESHOLD_MS, type HealthFacts, type HealthTask } from "../src/health.js";

const NOW = new Date("2026-09-05T15:00:00.000Z");

const task = (over: Partial<HealthTask> = {}): HealthTask => ({
  kind: "daily_draft",
  state: "done",
  createdAt: "2026-09-05T14:00:00.000Z",
  claimedAt: "2026-09-05T14:00:05.000Z",
  finishedAt: "2026-09-05T14:00:20.000Z",
  error: null,
  agent: "Writer",
  ...over,
});

const emptyFacts = (over: Partial<HealthFacts> = {}): HealthFacts => ({
  tasksToday: [],
  runningTasks: [],
  recentFailedTasks: [],
  lastCompletedAt: null,
  ...over,
});

describe("deriveHealth", () => {
  it("is healthy when today has finished tasks and nothing is stuck or failing", () => {
    const facts = emptyFacts({
      tasksToday: [
        task({ kind: "daily_draft", state: "done" }),
        task({ kind: "brief", state: "done", agent: "Chief of Staff" }),
      ],
      lastCompletedAt: "2026-09-05T14:00:20.000Z",
    });

    const result = deriveHealth(facts, NOW);

    expect(result.state).toBe("healthy");
    expect(result.evidence.join(" ")).toMatch(/2 task\(s\) today/);
  });

  it("reports nothing_ran_today when no task has finished today, even with older history", () => {
    const facts = emptyFacts({
      tasksToday: [],
      lastCompletedAt: "2026-09-04T14:00:20.000Z", // yesterday
    });

    const result = deriveHealth(facts, NOW);

    expect(result.state).toBe("nothing_ran_today");
    expect(result.evidence.join(" ")).toMatch(/Last completed run/);
  });

  it("reports nothing_ran_today when tasks were queued today but none have finished", () => {
    const facts = emptyFacts({
      tasksToday: [task({ state: "queued", claimedAt: null, finishedAt: null })],
      lastCompletedAt: "2026-09-04T14:00:20.000Z",
    });

    const result = deriveHealth(facts, NOW);

    expect(result.state).toBe("nothing_ran_today");
  });

  it("reports something_failed when a task has been running past the stuck threshold", () => {
    const stuckClaimedAt = new Date(NOW.getTime() - STUCK_RUNNING_THRESHOLD_MS - 60_000).toISOString();
    const facts = emptyFacts({
      tasksToday: [task({ state: "running", claimedAt: stuckClaimedAt, finishedAt: null })],
      runningTasks: [task({ state: "running", claimedAt: stuckClaimedAt, finishedAt: null, kind: "weekly_angles" })],
      lastCompletedAt: "2026-09-05T13:00:00.000Z",
    });

    const result = deriveHealth(facts, NOW);

    expect(result.state).toBe("something_failed");
    expect(result.evidence.join(" ")).toMatch(/running.*min/);
  });

  it("does not flag a task running well within the stuck threshold", () => {
    const recentClaimedAt = new Date(NOW.getTime() - 60_000).toISOString();
    const facts = emptyFacts({
      tasksToday: [
        task({ state: "done" }),
        task({ state: "running", claimedAt: recentClaimedAt, finishedAt: null }),
      ],
      runningTasks: [task({ state: "running", claimedAt: recentClaimedAt, finishedAt: null })],
      lastCompletedAt: "2026-09-05T14:00:20.000Z",
    });

    const result = deriveHealth(facts, NOW);

    expect(result.state).toBe("healthy");
  });

  it("reports something_failed when a task failed recently", () => {
    const facts = emptyFacts({
      tasksToday: [task({ state: "done" })],
      recentFailedTasks: [
        task({
          state: "failed",
          kind: "daily_draft",
          agent: "Writer",
          finishedAt: "2026-09-05T14:30:00.000Z",
          error: "claude exited 1",
        }),
      ],
      lastCompletedAt: "2026-09-05T14:30:00.000Z",
    });

    const result = deriveHealth(facts, NOW);

    expect(result.state).toBe("something_failed");
    expect(result.evidence.join(" ")).toMatch(/failed/);
    expect(result.evidence.join(" ")).toMatch(/claude exited 1/);
  });

  it("prioritizes something_failed over nothing_ran_today when both conditions hold", () => {
    const facts = emptyFacts({
      tasksToday: [],
      recentFailedTasks: [task({ state: "failed", finishedAt: "2026-09-05T13:00:00.000Z" })],
      lastCompletedAt: "2026-09-05T13:00:00.000Z",
    });

    const result = deriveHealth(facts, NOW);

    expect(result.state).toBe("something_failed");
  });
});
