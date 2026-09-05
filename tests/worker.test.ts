import { describe, it, expect, vi } from "vitest";
import { processOne } from "../src/worker.js";
import type { WorkerDeps } from "../src/worker.js";
import type { RunResult } from "../src/runner.js";

const task = { id: "t1", agent_id: "a1", kind: "daily_draft", state: "running",
               due_at: "", error: null } as any;
const agent = { id: "a1", key: "writer", display_name: "Writer", department: "Growth",
                level: 1, max_level: 4, streak: 0, recent_verdicts: [],
                instructions: "You are the Writer.", turn_cap: 8, enabled: true } as any;

const deps = (over: Partial<WorkerDeps> = {}): WorkerDeps => ({
  claimNextTask: vi.fn(async () => task),
  getAgent: vi.fn(async () => agent),
  countPendingDrafts: vi.fn(async () => 0),
  latestDraftBody: vi.fn(async () => null),
  insertDraft: vi.fn(async () => {}),
  finishTask: vi.fn(async () => {}),
  logEvent: vi.fn(async () => {}),
  runAgent: vi.fn(async (): Promise<RunResult> => ({ ok: true, body: "A perfectly good draft body." })),
  ...over,
});

describe("processOne", () => {
  it("is idle when no task is due", async () => {
    const d = deps({ claimNextTask: vi.fn(async () => null) });
    expect(await processOne(d, false)).toBe("idle");
    expect(d.runAgent).not.toHaveBeenCalled();
  });

  it("writes a draft and marks the task done", async () => {
    const d = deps();
    expect(await processOne(d, false)).toBe("produced");
    expect(d.insertDraft).toHaveBeenCalledWith("t1", "a1", "A perfectly good draft body.", false);
    expect(d.finishTask).toHaveBeenCalledWith("t1", "done");
  });

  it("does not run the agent when it is at the draft cap", async () => {
    const d = deps({ countPendingDrafts: vi.fn(async () => 3) });
    expect(await processOne(d, false)).toBe("skipped_at_capacity");
    expect(d.runAgent).not.toHaveBeenCalled();
    expect(d.finishTask).toHaveBeenCalledWith("t1", "done");
  });

  it("fails the task when the run errors", async () => {
    const d = deps({ runAgent: vi.fn(async (): Promise<RunResult> => ({ ok: false, reason: "claude exited 1" })) });
    expect(await processOne(d, false)).toBe("failed");
    expect(d.insertDraft).not.toHaveBeenCalled();
    expect(d.finishTask).toHaveBeenCalledWith("t1", "failed", "claude exited 1");
  });

  it("fails the task when the run repeats the previous draft", async () => {
    const d = deps({
      latestDraftBody: vi.fn(async () => "A perfectly good draft body."),
    });
    expect(await processOne(d, false)).toBe("failed");
    expect(d.insertDraft).not.toHaveBeenCalled();
  });

  it("routes dry-run output to the scratch table", async () => {
    const d = deps();
    await processOne(d, true);
    expect(d.insertDraft).toHaveBeenCalledWith("t1", "a1", "A perfectly good draft body.", true);
  });
});
