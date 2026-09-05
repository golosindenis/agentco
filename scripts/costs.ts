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

export type CostEvent = {
  agentName: string;
  costUsd: number;
  outputTokens: number;
  createdAt: string; // ISO timestamp
};

type AgentStats = { runs: number; totalCost: number; totalOutputTokens: number };
type DayStats = { runs: number; totalCost: number };

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

/** UTC calendar-day key (YYYY-MM-DD) for grouping and for the day table. */
function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Pure report builder: no network, no clock reads beyond the `now` passed
 * in. Isolated from src/db.ts's fetch so it can be tested with fixtures.
 */
export function buildReport(events: CostEvent[], now: Date = new Date()): string {
  if (events.length === 0) {
    return "No runs recorded yet.\n";
  }

  const byAgent = new Map<string, AgentStats>();
  for (const e of events) {
    const s = byAgent.get(e.agentName) ?? { runs: 0, totalCost: 0, totalOutputTokens: 0 };
    s.runs += 1;
    s.totalCost += e.costUsd;
    s.totalOutputTokens += e.outputTokens;
    byAgent.set(e.agentName, s);
  }

  const dayKeys: string[] = [];
  for (let i = REPORT_DAYS - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    dayKeys.push(d.toISOString().slice(0, 10));
  }
  const byDay = new Map<string, DayStats>();
  for (const key of dayKeys) byDay.set(key, { runs: 0, totalCost: 0 });
  for (const e of events) {
    const stats = byDay.get(dayKey(e.createdAt));
    if (stats) {
      stats.runs += 1;
      stats.totalCost += e.costUsd;
    }
  }

  const lines: string[] = [];

  lines.push("=== Cost by agent ===");
  lines.push(
    padRight("Agent", 20) + padLeft("Runs", 8) + padLeft("Total cost", 14) +
    padLeft("Avg/run", 12) + padLeft("Output tok", 14),
  );
  const agentRows = [...byAgent.entries()].sort((a, b) => b[1].totalCost - a[1].totalCost);
  for (const [name, s] of agentRows) {
    lines.push(
      padRight(name, 20) + padLeft(String(s.runs), 8) + padLeft(money(s.totalCost), 14) +
      padLeft(money(s.totalCost / s.runs), 12) + padLeft(String(s.totalOutputTokens), 14),
    );
  }

  lines.push("");
  lines.push(`=== Cost by day (last ${REPORT_DAYS} days) ===`);
  lines.push(padRight("Date", 14) + padLeft("Runs", 8) + padLeft("Total cost", 14));
  for (const key of dayKeys) {
    const s = byDay.get(key)!;
    lines.push(padRight(key, 14) + padLeft(String(s.runs), 8) + padLeft(money(s.totalCost), 14));
  }

  const totalRuns = events.length;
  const totalCost = events.reduce((sum, e) => sum + e.costUsd, 0);
  const sortedDays = events.map((e) => dayKey(e.createdAt)).sort();
  const earliest = sortedDays[0]!;
  const latest = sortedDays[sortedDays.length - 1]!;

  lines.push("");
  lines.push(`Grand total: ${totalRuns} runs, ${money(totalCost)}, ${earliest} to ${latest}`);
  lines.push("");
  lines.push(
    'These are list-price equivalents (costBasis: "list"), not a bill — Denis runs ' +
    "these agents on a Claude subscription and is not charged per run. Use this to " +
    "compare agents against each other and to see what the same work would cost on the API.",
  );

  return lines.join("\n") + "\n";
}

async function fetchCostEvents(): Promise<CostEvent[]> {
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
    agentName: row.agents?.display_name ?? "unknown",
    costUsd: typeof row.detail.costUsd === "number" ? row.detail.costUsd : 0,
    outputTokens: typeof row.detail.outputTokens === "number" ? row.detail.outputTokens : 0,
    createdAt: row.created_at,
  }));
}

async function main(): Promise<void> {
  const events = await fetchCostEvents();
  console.log(buildReport(events));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
