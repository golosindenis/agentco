/**
 * Prints a plain-text cost/usage report from `events`, so an expensive agent
 * is visible rather than a surprise.
 *
 *   npx tsx scripts/costs.ts
 *   npm run costs
 *
 * IMPORTANT: every dollar figure here is a list-price equivalent
 * (costBasis: "list" in the CLI's own JSON output). Denis runs these agents
 * on a Claude subscription, so none of this is a bill — it's useful for
 * comparing agents against each other and for knowing what a run would cost
 * on the API.
 */
import { supabase } from "../src/db.js";
import { totalsByAgent, totalsByDay, type RunEvent } from "../src/costs.js";

export const REPORT_DAYS = 14;

function padRight(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function padLeft(s: string, width: number): string {
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

function money(n: number): string {
  return `$${n.toFixed(4)}`;
}

/**
 * Pure report builder: no network, no clock reads beyond the `now` passed
 * in. Isolated from src/db.ts's fetch so it can be tested with fixtures.
 * The arithmetic itself lives in src/costs.ts (totalsByAgent/totalsByDay) —
 * this only maps that data into text.
 */
export function buildReport(events: RunEvent[], now: Date = new Date()): string {
  if (events.length === 0) {
    return "No runs recorded yet.\n";
  }

  const lines: string[] = [];

  lines.push("=== Cost by agent ===");
  lines.push(
    padRight("Agent", 20) + padLeft("Runs", 8) + padLeft("Total cost", 14) +
    padLeft("Avg/run", 12) + padLeft("Output tok", 14) + "  Uncosted",
  );
  const agentTotals = totalsByAgent(events);
  for (const t of agentTotals) {
    const uncosted = t.runs - t.costedRuns;
    const avg = t.avgCostUsd === null ? "n/a" : money(t.avgCostUsd);
    lines.push(
      padRight(t.agent, 20) + padLeft(String(t.runs), 8) + padLeft(money(t.totalCostUsd), 14) +
      padLeft(avg, 12) + padLeft(String(t.outputTokens), 14) +
      (uncosted > 0 ? `  ${uncosted} uncosted` : ""),
    );
  }

  lines.push("");
  lines.push(`=== Cost by day (last ${REPORT_DAYS} days) ===`);
  const dayTotals = totalsByDay(events, REPORT_DAYS, now);
  if (dayTotals.length === 0) {
    lines.push(`No runs in the last ${REPORT_DAYS} days.`);
  } else {
    lines.push(padRight("Date", 14) + padLeft("Runs", 8) + padLeft("Total cost", 14));
    for (const d of dayTotals) {
      lines.push(padRight(d.date, 14) + padLeft(String(d.runs), 8) + padLeft(money(d.totalCostUsd), 14));
    }
  }

  const totalRuns = events.length;
  const totalCostedRuns = agentTotals.reduce((sum, t) => sum + t.costedRuns, 0);
  const totalCost = agentTotals.reduce((sum, t) => sum + t.totalCostUsd, 0);
  const sortedDays = events.map((e) => e.createdAt.slice(0, 10)).sort();
  const earliest = sortedDays[0]!;
  const latest = sortedDays[sortedDays.length - 1]!;
  const uncostedRuns = totalRuns - totalCostedRuns;

  lines.push("");
  lines.push(
    `Grand total: ${totalRuns} runs, ${money(totalCost)}, ${earliest} to ${latest}` +
    (uncostedRuns > 0 ? ` (${uncostedRuns} uncosted, predate telemetry)` : ""),
  );
  lines.push("");
  lines.push(
    'These are list-price equivalents (costBasis: "list"), not a bill — Denis runs ' +
    "these agents on a Claude subscription and is not charged per run. Use this to " +
    "compare agents against each other and to see what the same work would cost on the API.",
  );

  return lines.join("\n") + "\n";
}

async function fetchRunEvents(): Promise<RunEvent[]> {
  const { data, error } = await supabase
    .from("events")
    .select("detail, created_at, agents(display_name)")
    .in("kind", ["draft_created", "brief_created"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(`costs report query failed: ${error.message}`);

  return ((data ?? []) as unknown as {
    detail: Record<string, unknown>;
    created_at: string;
    agents: { display_name: string } | null;
  }[]).map((row) => ({
    agent: row.agents?.display_name ?? "unknown",
    createdAt: row.created_at,
    // Missing telemetry means the run predates this feature, not that it
    // was free — leave it null rather than coercing to 0 (see src/costs.ts).
    costUsd: typeof row.detail.costUsd === "number" ? row.detail.costUsd : null,
    outputTokens: typeof row.detail.outputTokens === "number" ? row.detail.outputTokens : null,
  }));
}

async function main(): Promise<void> {
  const events = await fetchRunEvents();
  console.log(buildReport(events));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
