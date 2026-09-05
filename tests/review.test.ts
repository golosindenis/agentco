import { describe, it, expect, vi } from "vitest";
import { recordVerdict } from "../src/review.js";
import type { ReviewDeps } from "../src/review.js";

const state = { level: 1, maxLevel: 4, streak: 4, recent: [] };

const deps = (over: Partial<ReviewDeps> = {}): ReviewDeps => ({
  loadState: vi.fn(async () => ({ ...state })),
  saveState: vi.fn(async () => {}),
  setDraftStatus: vi.fn(async () => {}),
  insertApproval: vi.fn(async () => {}),
  insertFeedback: vi.fn(async () => {}),
  ...over,
});

describe("recordVerdict", () => {
  it("promotes on the fifth clean approval and saves the new standing", async () => {
    const d = deps();
    const next = await recordVerdict(d, "d1", "a1", "approved");
    expect(next.level).toBe(2);
    expect(d.saveState).toHaveBeenCalledWith("a1", next);
    expect(d.setDraftStatus).toHaveBeenCalledWith("d1", "approved");
  });

  it("marks an edited approval as approved on the draft", async () => {
    const d = deps();
    await recordVerdict(d, "d1", "a1", "approved_with_edit");
    expect(d.setDraftStatus).toHaveBeenCalledWith("d1", "approved");
  });

  it("writes the decline reason to feedback", async () => {
    const d = deps();
    await recordVerdict(d, "d1", "a1", "declined", "too salesy");
    expect(d.insertFeedback).toHaveBeenCalledWith("a1", "too salesy");
    expect(d.setDraftStatus).toHaveBeenCalledWith("d1", "declined");
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
});
