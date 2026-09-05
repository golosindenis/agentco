import { describe, it, expect, vi } from "vitest";
import { processOne } from "../src/worker.js";
import type { WorkerDeps } from "../src/worker.js";
import type { RunResult } from "../src/runner.js";
import type { BriefFacts } from "../src/db.js";

const task = { id: "t1", agent_id: "a1", kind: "daily_draft", state: "running",
               due_at: "", error: null } as any;
const weeklyTask = { ...task, kind: "weekly_angles" };
const briefTask = { ...task, kind: "brief" };
const agent = { id: "a1", key: "writer", display_name: "Writer", department: "Growth",
                level: 1, max_level: 4, streak: 0, recent_verdicts: [],
                instructions: "You are the Writer.", turn_cap: 8, enabled: true } as any;

const defaultBriefFacts: BriefFacts = {
  since: "2020-01-01T00:00:00.000Z",
  tasksByState: {},
  failures: [],
  draftsCreated: 0,
  pendingByAgent: [],
};

const deps = (over: Partial<WorkerDeps> = {}): WorkerDeps => ({
  claimNextTask: vi.fn(async () => task),
  getAgent: vi.fn(async () => agent),
  countPendingDrafts: vi.fn(async () => 0),
  latestDraftBody: vi.fn(async () => null),
  latestApprovedDraftBody: vi.fn(async () => "1. A default approved angle."),
  insertDraft: vi.fn(async () => {}),
  finishTask: vi.fn(async () => {}),
  logEvent: vi.fn(async () => {}),
  gatherBriefFacts: vi.fn(async () => defaultBriefFacts),
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

  it("marks the task failed instead of throwing when the agent run throws", async () => {
    const d = deps({
      runAgent: vi.fn(async (): Promise<RunResult> => { throw new Error("transient network blip"); }),
    });
    await expect(processOne(d, false)).resolves.toBe("failed");
    expect(d.finishTask).toHaveBeenCalledWith("t1", "failed", expect.any(String));
  });

  it("reports success instead of failure when a throw happens after the draft is written", async () => {
    const d = deps({
      logEvent: vi.fn(async (kind: string) => {
        if (kind === "draft_created") throw new Error("log sink unavailable");
      }),
    });
    await expect(processOne(d, false)).resolves.toBe("produced");
    expect(d.insertDraft).toHaveBeenCalled();
    expect(d.finishTask).toHaveBeenCalledWith("t1", "done");
  });

  it("still resolves to failed when finishTask itself throws while recording the failure", async () => {
    const d = deps({
      runAgent: vi.fn(async (): Promise<RunResult> => { throw new Error("transient network blip"); }),
      finishTask: vi.fn(async () => { throw new Error("db unreachable"); }),
    });
    await expect(processOne(d, false)).resolves.toBe("failed");
  });

  it("does not propagate when finishTask(\"done\") fails after a successful draft write", async () => {
    const d = deps({
      finishTask: vi.fn(async () => { throw new Error("db unreachable"); }),
    });
    await expect(processOne(d, false)).resolves.toBe("produced");
    expect(d.insertDraft).toHaveBeenCalled();
  });

  it("handles an unstringifiable thrown value without rejecting", async () => {
    const d = deps({
      runAgent: vi.fn(async (): Promise<RunResult> => {
        throw { toString() { throw new Error("nope"); } };
      }),
    });
    await expect(processOne(d, false)).resolves.toBe("failed");
    expect(d.finishTask).toHaveBeenCalledWith("t1", "failed", expect.any(String));
  });

  it("passes the approved angle bank into the daily_draft prompt", async () => {
    const d = deps({
      latestApprovedDraftBody: vi.fn(async () => "1. Angle one\n2. Angle two"),
    });
    expect(await processOne(d, false)).toBe("produced");
    expect(d.latestApprovedDraftBody).toHaveBeenCalledWith("weekly_angles");
    const call = (d.runAgent as any).mock.calls[0];
    expect(call[1]).toContain("Angle one");
    expect(call[1]).toContain("Angle two");
  });

  it("fails a daily_draft task without calling runAgent when there is no approved angle bank", async () => {
    const d = deps({ latestApprovedDraftBody: vi.fn(async () => null) });
    expect(await processOne(d, false)).toBe("failed");
    expect(d.runAgent).not.toHaveBeenCalled();
    expect(d.insertDraft).not.toHaveBeenCalled();
    expect(d.finishTask).toHaveBeenCalledWith("t1", "failed", expect.any(String));
    expect(d.logEvent).toHaveBeenCalledWith(
      expect.any(String), expect.any(Object), "a1", "t1",
    );
  });

  it("does not fetch an angle bank for a weekly_angles task", async () => {
    const d = deps({ claimNextTask: vi.fn(async () => weeklyTask) });
    expect(await processOne(d, false)).toBe("produced");
    expect(d.latestApprovedDraftBody).not.toHaveBeenCalled();
  });

  it("does not reject a brief task whose output repeats the previous brief verbatim", async () => {
    const d = deps({
      claimNextTask: vi.fn(async () => briefTask),
      latestDraftBody: vi.fn(async () => "Nothing ran overnight."),
      runAgent: vi.fn(async (): Promise<RunResult> => ({ ok: true, body: "Nothing ran overnight." })),
    });
    expect(await processOne(d, false)).toBe("produced");
    expect(d.insertDraft).toHaveBeenCalledWith("t1", "a1", "Nothing ran overnight.", false);
  });

  it("passes the gathered brief facts into the prompt for a brief task", async () => {
    const facts: BriefFacts = {
      since: "2026-09-04T09:00:00.000Z",
      tasksByState: { done: 3, failed: 1 },
      failures: [{ agent: "Writer", kind: "daily_draft", error: "boom" }],
      draftsCreated: 2,
      pendingByAgent: [{ agent: "Writer", pending: 1 }],
    };
    const d = deps({
      claimNextTask: vi.fn(async () => briefTask),
      gatherBriefFacts: vi.fn(async () => facts),
    });
    expect(await processOne(d, false)).toBe("produced");
    expect(d.gatherBriefFacts).toHaveBeenCalled();
    const call = (d.runAgent as any).mock.calls[0];
    expect(call[1]).toContain("draftsCreated");
    expect(call[1]).toContain("Writer");
    expect(call[1]).toContain("boom");
  });

  it("does not call gatherBriefFacts for a non-brief task", async () => {
    const d = deps();
    expect(await processOne(d, false)).toBe("produced");
    expect(d.gatherBriefFacts).not.toHaveBeenCalled();
  });

  it("passes the dry-run flag through to countPendingDrafts and latestDraftBody", async () => {
    const d = deps();
    expect(await processOne(d, true)).toBe("produced");
    expect(d.countPendingDrafts).toHaveBeenCalledWith("a1", true);
    expect(d.latestDraftBody).toHaveBeenCalledWith("a1", true);
  });

  it("skips a disabled agent's task without spawning the agent", async () => {
    const disabledAgent = { ...agent, enabled: false };
    const d = deps({ getAgent: vi.fn(async () => disabledAgent) });
    expect(await processOne(d, false)).toBe("skipped_disabled");
    expect(d.runAgent).not.toHaveBeenCalled();
    expect(d.countPendingDrafts).not.toHaveBeenCalled();
    expect(d.finishTask).toHaveBeenCalledWith("t1", "done");
    expect(d.logEvent).toHaveBeenCalled();
  });
});
