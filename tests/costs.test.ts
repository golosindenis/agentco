import { describe, it, expect } from "vitest";
import { totalsByAgent, totalsByDay, type RunEvent } from "../src/costs.js";

describe("totalsByAgent", () => {
  it("averages over run count when every run is costed", () => {
    const events: RunEvent[] = [
      { agent: "Writer", createdAt: "2026-09-01T09:00:00.000Z", costUsd: 0.10, outputTokens: 100 },
      { agent: "Writer", createdAt: "2026-09-02T09:00:00.000Z", costUsd: 0.20, outputTokens: 150 },
    ];
    const [writer] = totalsByAgent(events);
    expect(writer!.agent).toBe("Writer");
    expect(writer!.runs).toBe(2);
    expect(writer!.costedRuns).toBe(2);
    expect(writer!.totalCostUsd).toBeCloseTo(0.30);
    expect(writer!.avgCostUsd).toBeCloseTo(0.15);
    expect(writer!.outputTokens).toBe(250);
  });

  it("averages over only the costed runs when some runs predate telemetry", () => {
    const events: RunEvent[] = [
      // This run predates telemetry: no cost, no output tokens.
      { agent: "Chief of Staff", createdAt: "2026-08-01T09:00:00.000Z", costUsd: null, outputTokens: null },
      { agent: "Chief of Staff", createdAt: "2026-09-01T09:00:00.000Z", costUsd: 0.1089, outputTokens: 86 },
    ];
    const [cos] = totalsByAgent(events);
    expect(cos!.runs).toBe(2);
    expect(cos!.costedRuns).toBe(1);
    expect(cos!.costedRuns).toBeLessThan(cos!.runs);
    expect(cos!.totalCostUsd).toBeCloseTo(0.1089);
    expect(cos!.avgCostUsd).toBeCloseTo(0.1089); // not 0.05445 — the old, wrong denominator
  });

  it("reports avgCostUsd as null, never a division by zero, when no run is costed", () => {
    const events: RunEvent[] = [
      { agent: "Strategist", createdAt: "2026-08-01T09:00:00.000Z", costUsd: null, outputTokens: null },
      { agent: "Strategist", createdAt: "2026-08-08T09:00:00.000Z", costUsd: null, outputTokens: null },
    ];
    const [strategist] = totalsByAgent(events);
    expect(strategist!.runs).toBe(2);
    expect(strategist!.costedRuns).toBe(0);
    expect(strategist!.totalCostUsd).toBe(0);
    expect(strategist!.avgCostUsd).toBeNull();
    expect(Number.isNaN(strategist!.avgCostUsd)).toBe(false);
  });

  it("orders agents by total cost descending, most expensive first", () => {
    const events: RunEvent[] = [
      { agent: "Writer", createdAt: "2026-09-01T09:00:00.000Z", costUsd: 0.01, outputTokens: 10 },
      { agent: "Chief of Staff", createdAt: "2026-09-01T09:00:00.000Z", costUsd: 0.50, outputTokens: 500 },
      { agent: "Strategist", createdAt: "2026-09-01T09:00:00.000Z", costUsd: 0.10, outputTokens: 100 },
    ];
    const totals = totalsByAgent(events);
    expect(totals.map((t) => t.agent)).toEqual(["Chief of Staff", "Strategist", "Writer"]);
  });
});

describe("totalsByDay", () => {
  // Local dates, constructed explicitly (not parsed from a UTC ISO string),
  // consistent with src/schedule.ts — assert the day so a timezone slip in
  // the test itself fails loudly rather than passing by accident.
  const NOW = new Date(2026, 8, 5, 12, 0, 0); // local 2026-09-05 noon

  function localIso(y: number, m: number, d: number, h = 9): string {
    return new Date(y, m, d, h, 0, 0).toISOString();
  }

  it("sanity-checks the NOW fixture", () => {
    expect(NOW.getFullYear()).toBe(2026);
    expect(NOW.getMonth()).toBe(8);
    expect(NOW.getDate()).toBe(5);
  });

  it("omits days with no runs", () => {
    const events: RunEvent[] = [
      { agent: "Writer", createdAt: localIso(2026, 8, 5), costUsd: 0.10, outputTokens: 100 },
    ];
    const days = totalsByDay(events, 14, NOW);
    expect(days).toHaveLength(1);
    expect(days[0]!.date).toBe("2026-09-05");
    expect(days[0]!.runs).toBe(1);
  });

  it("says none when the window contains no runs at all", () => {
    const days = totalsByDay([], 14, NOW);
    expect(days).toEqual([]);
  });

  it("excludes runs older than the window", () => {
    const events: RunEvent[] = [
      // 20 days before NOW: outside a 14-day window.
      { agent: "Writer", createdAt: localIso(2026, 7, 16), costUsd: 0.10, outputTokens: 100 },
      // Inside the window.
      { agent: "Writer", createdAt: localIso(2026, 8, 5), costUsd: 0.05, outputTokens: 50 },
    ];
    const days = totalsByDay(events, 14, NOW);
    expect(days).toHaveLength(1);
    expect(days[0]!.date).toBe("2026-09-05");
  });

  it("groups two runs on the same local day into one row", () => {
    const events: RunEvent[] = [
      { agent: "Writer", createdAt: localIso(2026, 8, 4, 8), costUsd: 0.10, outputTokens: 100 },
      { agent: "Writer", createdAt: localIso(2026, 8, 4, 20), costUsd: 0.20, outputTokens: 200 },
    ];
    const days = totalsByDay(events, 14, NOW);
    expect(days).toHaveLength(1);
    expect(days[0]!.date).toBe("2026-09-04");
    expect(days[0]!.runs).toBe(2);
    expect(days[0]!.totalCostUsd).toBeCloseTo(0.30);
  });

  it("orders most recent day first", () => {
    const events: RunEvent[] = [
      { agent: "Writer", createdAt: localIso(2026, 8, 1), costUsd: 0.01, outputTokens: 10 },
      { agent: "Writer", createdAt: localIso(2026, 8, 5), costUsd: 0.02, outputTokens: 20 },
      { agent: "Writer", createdAt: localIso(2026, 8, 3), costUsd: 0.03, outputTokens: 30 },
    ];
    const days = totalsByDay(events, 14, NOW);
    expect(days.map((d) => d.date)).toEqual(["2026-09-05", "2026-09-03", "2026-09-01"]);
  });

  it("counts an uncosted run toward the day's run count without adding to its cost", () => {
    const events: RunEvent[] = [
      { agent: "Chief of Staff", createdAt: localIso(2026, 8, 5), costUsd: null, outputTokens: null },
    ];
    const days = totalsByDay(events, 14, NOW);
    expect(days).toEqual([{ date: "2026-09-05", runs: 1, totalCostUsd: 0 }]);
  });
});
