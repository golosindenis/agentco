import { describe, it, expect } from "vitest";
import { SUBJECTS, subjectFor, bankHasSubject, type SubjectKey } from "../src/subjects.js";

// 2026-09-14 is a Monday.
const day = (offset: number) => new Date(2026, 8, 14 + offset, 7, 0, 0);

describe("subjectFor", () => {
  it("gives every weekday exactly one subject", () => {
    for (let i = 0; i < 7; i++) {
      const s = subjectFor(day(i));
      expect(Object.keys(SUBJECTS)).toContain(s);
    }
  });

  it("covers all three daily subjects within a single week", () => {
    const week = new Set<SubjectKey>();
    for (let i = 0; i < 7; i++) week.add(subjectFor(day(i)));
    // The whole reason the rota is fixed rather than left to the Writer:
    // no subject may be silently starved.
    expect(week).toEqual(new Set(["attune", "denis", "agentco"]));
  });

  it("gives Attune the most slots, as the full-time commitment", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 7; i++) {
      const s = subjectFor(day(i));
      counts[s] = (counts[s] ?? 0) + 1;
    }
    expect(counts.attune).toBeGreaterThan(counts.agentco!);
    expect(counts.attune).toBeGreaterThanOrEqual(counts.denis!);
  });

  it("is deterministic — the same date always yields the same subject", () => {
    expect(subjectFor(day(0))).toBe(subjectFor(new Date(2026, 8, 14, 23, 59)));
  });

  it("uses the local day, not UTC", () => {
    // 23:30 local on a Monday is Tuesday in UTC for Denis (+04). The rota
    // must follow the day he is living in, or a late catch-up run posts
    // tomorrow's subject.
    const lateMonday = new Date(2026, 8, 14, 23, 30);
    expect(subjectFor(lateMonday)).toBe(subjectFor(new Date(2026, 8, 14, 9, 0)));
  });

  it("gives every subject a voice rule the Writer can follow", () => {
    for (const s of Object.values(SUBJECTS)) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.voice.length).toBeGreaterThan(20);
    }
  });
});

describe("bankHasSubject", () => {
  const bank = "1. [Attune] something\n\n2. [agentco] something else";

  it("finds a subject the bank covers", () => {
    expect(bankHasSubject(bank, "attune")).toBe(true);
    expect(bankHasSubject(bank, "agentco")).toBe(true);
  });

  it("reports a subject the bank has nothing for", () => {
    // The exact situation after angle 5 was edited out on 2026-09-12: a bank
    // with no [Denis] angle, on a day the rota says is Denis's.
    expect(bankHasSubject(bank, "denis")).toBe(false);
  });
});
