import { describe, it, expect, vi } from "vitest";
import { recordVerdict } from "../src/review.js";
import type { ReviewDeps } from "../src/review.js";
import type { Verdict } from "../src/types.js";

const state = { level: 1, maxLevel: 4, streak: 4, recent: [] };

const deps = (over: Partial<ReviewDeps> = {}): ReviewDeps => ({
  loadState: vi.fn(async () => ({ ...state })),
  saveState: vi.fn(async () => {}),
  setDraftStatus: vi.fn(async () => {}),
  insertApproval: vi.fn(async () => {}),
  insertFeedback: vi.fn(async () => {}),
  loadInstructions: vi.fn(async () => ""),
  saveInstructions: vi.fn(async () => {}),
  recordedVerdict: vi.fn(async () => null),
  ...over,
});

describe("recordVerdict", () => {
  it("promotes on the fifth clean approval and saves the new standing", async () => {
    const d = deps();
    const result = await recordVerdict(d, "d1", "a1", "approved");
    expect(result.state.level).toBe(2);
    expect(d.saveState).toHaveBeenCalledWith("a1", result.state);
    expect(d.setDraftStatus).toHaveBeenCalledWith("d1", "approved");
    expect(result.alreadyDecided).toBe(false);
    expect(result.recordedVerdict).toBe(null);
  });

  it("marks an edited approval as approved on the draft", async () => {
    const d = deps();
    await recordVerdict(d, "d1", "a1", "approved_with_edit");
    expect(d.setDraftStatus).toHaveBeenCalledWith("d1", "approved");
  });

  it("writes the decline reason to feedback", async () => {
    const d = deps();
    const result = await recordVerdict(d, "d1", "a1", "declined", "too salesy");
    expect(d.insertFeedback).toHaveBeenCalledWith("a1", "too salesy");
    expect(d.setDraftStatus).toHaveBeenCalledWith("d1", "declined");
    expect(result.alreadyDecided).toBe(false);
  });

  it("does not write feedback when there is no decline reason", async () => {
    const d = deps();
    await recordVerdict(d, "d1", "a1", "approved");
    expect(d.insertFeedback).not.toHaveBeenCalled();
  });

  it("counts one rule per non-empty instruction line", async () => {
    const { countRules, MAX_RULES } = await import("../src/review.js");
    expect(MAX_RULES).toBe(30);
    expect(countRules("one\n\n  two  \nthree\n")).toBe(3);
    expect(countRules("")).toBe(0);
  });

  it("always records the approval row", async () => {
    const d = deps();
    await recordVerdict(d, "d1", "a1", "declined", "wrong angle");
    expect(d.insertApproval).toHaveBeenCalledWith("d1", "declined", "wrong angle");
  });

  it("appends the decline reason as a rule to the agent's instructions", async () => {
    const d = deps({ loadInstructions: vi.fn(async () => "rule one\nrule two") });
    await recordVerdict(d, "d1", "a1", "declined", "too salesy");
    expect(d.saveInstructions).toHaveBeenCalledWith("a1", "rule one\nrule two\ntoo salesy");
  });

  it("returns ruleAppended: true and the incremented rule count for a decline below the cap", async () => {
    const d = deps({ loadInstructions: vi.fn(async () => "rule one\nrule two") });
    const result = await recordVerdict(d, "d1", "a1", "declined", "too salesy");
    expect(result.ruleAppended).toBe(true);
    expect(result.ruleCount).toBe(3);
  });

  it("does not touch instructions on an approval", async () => {
    const d = deps();
    await recordVerdict(d, "d1", "a1", "approved");
    expect(d.saveInstructions).not.toHaveBeenCalled();
  });

  it("does not append past the rule cap, but still records feedback", async () => {
    const { MAX_RULES } = await import("../src/review.js");
    const atCap = Array.from({ length: MAX_RULES }, (_, i) => `rule ${i}`).join("\n");
    const d = deps({ loadInstructions: vi.fn(async () => atCap) });
    const result = await recordVerdict(d, "d1", "a1", "declined", "one more thing");
    expect(d.saveInstructions).not.toHaveBeenCalled();
    expect(d.insertFeedback).toHaveBeenCalledWith("a1", "one more thing");
    expect(result.ruleAppended).toBe(false);
    expect(result.ruleCount).toBe(MAX_RULES);
  });

  it("treats a whitespace-only decline reason as no reason at all", async () => {
    const d = deps();
    const result = await recordVerdict(d, "d1", "a1", "declined", "   ");
    expect(d.insertFeedback).not.toHaveBeenCalled();
    expect(d.saveInstructions).not.toHaveBeenCalled();
    expect(result.ruleAppended).toBe(false);
  });

  it("normalises a multi-line decline reason to a single rule line", async () => {
    const { countRules } = await import("../src/review.js");
    const before = "rule one\nrule two";
    const d = deps({ loadInstructions: vi.fn(async () => before) });
    await recordVerdict(d, "d1", "a1", "declined", "line one\n\n  line two  \nline three");
    const saved = (d.saveInstructions as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expect(saved).not.toMatch(/\n\n/);
    expect(countRules(saved)).toBe(countRules(before) + 1);
  });

  it("does not report a duplicate decline as an appended rule, and leaves the rule count unchanged", async () => {
    const d = deps({ loadInstructions: vi.fn(async () => "rule one\ntoo salesy") });
    const result = await recordVerdict(d, "d1", "a1", "declined", "Too   SALESY");
    expect(d.saveInstructions).not.toHaveBeenCalled();
    expect(result.ruleAppended).toBe(false);
    expect(result.ruleCount).toBe(2);
  });

  it("leaves the draft status untouched when the ladder update throws mid-verdict", async () => {
    const d = deps({ saveState: vi.fn(async () => { throw new Error("db blip"); }) });
    await expect(recordVerdict(d, "d1", "a1", "approved")).rejects.toThrow("db blip");
    expect(d.setDraftStatus).not.toHaveBeenCalled();
  });

  it("skips approval, feedback and the ladder on a retry, but still sets the draft status", async () => {
    // A genuine retry: the same verdict is being resubmitted (e.g. after a
    // transient failure on the first attempt's status write). The recorded
    // verdict matches what's being submitted now.
    const d = deps({ recordedVerdict: vi.fn(async (): Promise<Verdict | null> => "declined") });
    const result = await recordVerdict(d, "d1", "a1", "declined", "too salesy");
    expect(d.insertApproval).not.toHaveBeenCalled();
    expect(d.insertFeedback).not.toHaveBeenCalled();
    expect(d.saveState).not.toHaveBeenCalled();
    expect(d.setDraftStatus).toHaveBeenCalledWith("d1", "declined");
    expect(result.ruleAppended).toBe(false);
    expect(result.alreadyDecided).toBe(true);
    expect(result.recordedVerdict).toBe("declined");
  });

  it("keeps the draft approved and discards a later decline with a different verdict", async () => {
    // Denis approved this draft earlier (from one surface); a stale second
    // surface now submits a decline with a reason for the same draft. The
    // approval already recorded is the decision that actually took effect —
    // its approval row, ladder move, etc. already happened — so the decline
    // must not be applied: no new approval row, no feedback row, no rule, no
    // ladder move, and the draft's status must stay "approved", not flip to
    // "declined" out from under a recorded approval that doesn't support it.
    const d = deps({ recordedVerdict: vi.fn(async (): Promise<Verdict | null> => "approved") });
    const result = await recordVerdict(d, "d1", "a1", "declined", "way too salesy, redo it");
    expect(d.insertApproval).not.toHaveBeenCalled();
    expect(d.insertFeedback).not.toHaveBeenCalled();
    expect(d.saveInstructions).not.toHaveBeenCalled();
    expect(d.saveState).not.toHaveBeenCalled();
    expect(d.setDraftStatus).toHaveBeenCalledWith("d1", "approved");
    expect(result.alreadyDecided).toBe(true);
    expect(result.recordedVerdict).toBe("approved");
    expect(result.ruleAppended).toBe(false);
  });

  it("keeps the draft declined when a later approve arrives for an already-declined draft", async () => {
    const d = deps({ recordedVerdict: vi.fn(async (): Promise<Verdict | null> => "declined") });
    const result = await recordVerdict(d, "d1", "a1", "approved");
    expect(d.insertApproval).not.toHaveBeenCalled();
    expect(d.saveState).not.toHaveBeenCalled();
    expect(d.setDraftStatus).toHaveBeenCalledWith("d1", "declined");
    expect(result.alreadyDecided).toBe(true);
    expect(result.recordedVerdict).toBe("declined");
  });
});

describe("appendRule", () => {
  it("appends a rule as a new line", async () => {
    const { appendRule } = await import("../src/review.js");
    expect(appendRule("rule one", "rule two")).toBe("rule one\nrule two");
  });

  it("does not add a leading blank line when instructions is empty", async () => {
    const { appendRule } = await import("../src/review.js");
    expect(appendRule("", "rule one")).toBe("rule one");
  });

  it("collapses newlines and whitespace in the rule and trims it", async () => {
    const { appendRule } = await import("../src/review.js");
    expect(appendRule("rule one", "  line a\n\n line b  ")).toBe("rule one\nline a line b");
  });

  it("does not duplicate a rule already present verbatim", async () => {
    const { appendRule } = await import("../src/review.js");
    expect(appendRule("rule one\nrule two", "rule two")).toBe("rule one\nrule two");
  });

  it("treats near-duplicate rules (case and internal whitespace) as the same rule", async () => {
    const { appendRule } = await import("../src/review.js");
    const withFirst = appendRule("", "too salesy");
    const withSecond = appendRule(withFirst, "Too Salesy");
    const withThird = appendRule(withSecond, "too   salesy");
    expect(withThird).toBe(withFirst);
  });

  it("stores the rule with its original casing", async () => {
    const { appendRule } = await import("../src/review.js");
    expect(appendRule("", "Too Salesy")).toBe("Too Salesy");
  });
});
