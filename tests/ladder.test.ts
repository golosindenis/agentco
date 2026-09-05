import { describe, it, expect } from "vitest";
import { applyVerdict } from "../src/ladder.js";
import type { AgentState } from "../src/types.js";

const fresh = (over: Partial<AgentState> = {}): AgentState => ({
  level: 1, maxLevel: 4, streak: 0, recent: [], ...over,
});

describe("promotion", () => {
  it("promotes on the fifth consecutive clean approval", () => {
    let s = fresh();
    for (let i = 0; i < 4; i++) s = applyVerdict(s, "approved");
    expect(s.level).toBe(1);
    expect(s.streak).toBe(4);

    s = applyVerdict(s, "approved");
    expect(s.level).toBe(2);
    expect(s.streak).toBe(0);
  });

  it("never promotes past maxLevel", () => {
    let s = fresh({ level: 2, maxLevel: 2, streak: 4 });
    s = applyVerdict(s, "approved");
    expect(s.level).toBe(2);
  });

  it("never promotes past level 4", () => {
    let s = fresh({ level: 4, streak: 4 });
    s = applyVerdict(s, "approved");
    expect(s.level).toBe(4);
  });

  it("never lowers the level when maxLevel was dropped below the current level", () => {
    let s = fresh({ level: 3, maxLevel: 2, streak: 4 });
    s = applyVerdict(s, "approved");
    expect(s.level).toBe(3);
    expect(s.streak).toBe(0);
  });
});

describe("approve-after-edit", () => {
  it("resets the streak without changing the level", () => {
    let s = fresh({ streak: 4 });
    s = applyVerdict(s, "approved_with_edit");
    expect(s.streak).toBe(0);
    expect(s.level).toBe(1);
  });
});

describe("demotion", () => {
  it("demotes on the second decline within the last five verdicts", () => {
    let s = fresh({ level: 3 });
    s = applyVerdict(s, "declined");
    expect(s.level).toBe(3);

    s = applyVerdict(s, "declined");
    expect(s.level).toBe(2);
  });

  it("does not demote when the declines are more than five verdicts apart", () => {
    let s = fresh({ level: 3 });
    s = applyVerdict(s, "declined");
    for (let i = 0; i < 5; i++) s = applyVerdict(s, "approved_with_edit");
    s = applyVerdict(s, "declined");
    expect(s.level).toBe(3);
  });

  it("clears history on demotion so it takes two fresh declines to demote again", () => {
    let s = fresh({ level: 4 });
    s = applyVerdict(s, "declined");
    s = applyVerdict(s, "declined");
    expect(s.level).toBe(3);
    expect(s.recent).toEqual([]);

    s = applyVerdict(s, "declined");
    expect(s.level).toBe(3);
  });

  it("never demotes below level 1", () => {
    let s = fresh({ level: 1 });
    s = applyVerdict(s, "declined");
    s = applyVerdict(s, "declined");
    expect(s.level).toBe(1);
  });

  it("resets the promotion streak", () => {
    let s = fresh({ streak: 4 });
    s = applyVerdict(s, "declined");
    expect(s.streak).toBe(0);
  });
});

describe("purity", () => {
  it("does not mutate the input state", () => {
    const s = fresh({ streak: 2 });
    applyVerdict(s, "approved");
    expect(s.streak).toBe(2);
  });
});
