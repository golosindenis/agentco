import { describe, it, expect } from "vitest";
import { buildReport, REPORT_DAYS, type CostEvent } from "../scripts/costs.js";

const NOW = new Date("2026-09-05T12:00:00.000Z");

describe("buildReport", () => {
  it("handles the empty case without crashing", () => {
    expect(buildReport([], NOW)).toBe("No runs recorded yet.\n");
  });

  it("aggregates runs, total cost, average cost, and output tokens per agent", () => {
    const events: CostEvent[] = [
      { agentName: "Writer", costUsd: 0.10, outputTokens: 100, createdAt: "2026-09-05T09:00:00.000Z" },
      { agentName: "Writer", costUsd: 0.20, outputTokens: 150, createdAt: "2026-09-04T09:00:00.000Z" },
      { agentName: "Strategist", costUsd: 0.05, outputTokens: 50, createdAt: "2026-09-05T10:00:00.000Z" },
    ];
    const report = buildReport(events, NOW);

    expect(report).toContain("Writer");
    expect(report).toContain("2"); // Writer's run count
    expect(report).toContain("$0.3000"); // Writer's total cost
    expect(report).toContain("$0.1500"); // Writer's average cost per run
    expect(report).toContain("250"); // Writer's total output tokens
    expect(report).toContain("Strategist");
  });

  it("groups cost and run count by UTC calendar day over the last 14 days", () => {
    const events: CostEvent[] = [
      { agentName: "Writer", costUsd: 0.10, outputTokens: 100, createdAt: "2026-09-05T09:00:00.000Z" },
      { agentName: "Writer", costUsd: 0.20, outputTokens: 100, createdAt: "2026-09-05T11:00:00.000Z" },
      { agentName: "Writer", costUsd: 0.30, outputTokens: 100, createdAt: "2026-09-01T09:00:00.000Z" },
    ];
    const report = buildReport(events, NOW);

    expect(report).toContain(`last ${REPORT_DAYS} days`);
    expect(report).toContain("2026-09-05");
    expect(report).toContain("2026-09-01");
    expect(report).toContain("$0.3000"); // 2026-09-05's total (0.10 + 0.20)
  });

  it("reports a grand total with run count and date range, and a closing list-price disclaimer", () => {
    const events: CostEvent[] = [
      { agentName: "Writer", costUsd: 0.10, outputTokens: 100, createdAt: "2026-09-01T09:00:00.000Z" },
      { agentName: "Writer", costUsd: 0.05, outputTokens: 50, createdAt: "2026-09-05T09:00:00.000Z" },
    ];
    const report = buildReport(events, NOW);

    expect(report).toContain("Grand total: 2 runs");
    expect(report).toContain("$0.1500");
    expect(report).toContain("2026-09-01 to 2026-09-05");
    expect(report.toLowerCase()).toContain("not a bill");
    expect(report.toLowerCase()).toContain("subscription");
  });
});
