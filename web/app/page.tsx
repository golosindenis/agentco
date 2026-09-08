import { redirect } from "next/navigation";
import {
  getHealthFacts,
  listAgents,
  pendingDraftCountsByAgent,
  lastEventTimeByAgent,
  pendingDrafts,
  approvedUnpostedDrafts,
  latestBrief,
  listRunEvents,
  recentEvents,
} from "../../src/db.js";
import { deriveHealth } from "../../src/health.js";
import { totalsByAgent, totalsByDay } from "../../src/costs.js";
import { currentUser } from "./lib/supabaseServer";
import { Sidebar } from "./Sidebar";
import { TodayView } from "./TodayView";
import { OverviewView } from "./OverviewView";

// This page reads live database state on every request — it's an
// operations surface, not marketing content, and a cached "did it run?"
// banner would defeat the entire point of the page.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // The middleware matcher is the first gate, but a server component that
  // reads the whole operations database should not rest on routing config
  // alone — this is the same currentUser() check the write actions already
  // use, folding in the allowlist so "signed in" and "signed in as Denis"
  // can never be conflated here either.
  const user = await currentUser();
  if (!user) redirect("/login");

  const now = new Date();

  const [
    facts,
    agents,
    pendingCounts,
    lastRun,
    pending,
    toPost,
    brief,
    runEvents,
    recent,
  ] = await Promise.all([
    getHealthFacts(now),
    listAgents(),
    pendingDraftCountsByAgent(),
    lastEventTimeByAgent(),
    pendingDrafts(),
    approvedUnpostedDrafts(),
    latestBrief(),
    listRunEvents(),
    recentEvents(20),
  ]);

  const health = deriveHealth(facts, now);
  const agentTotals = totalsByAgent(runEvents);
  const today = totalsByDay(runEvents, 1, now);
  const last7 = totalsByDay(runEvents, 7, now);
  const todayCost = today[0]?.totalCostUsd ?? 0;
  const todayRuns = today[0]?.runs ?? 0;
  const last7Cost = last7.reduce((sum, d) => sum + d.totalCostUsd, 0);
  const last7Runs = last7.reduce((sum, d) => sum + d.runs, 0);
  const grandTotalCost = agentTotals.reduce((sum, t) => sum + t.totalCostUsd, 0);

  return (
    <div className="shell">
      <Sidebar agents={agents} pendingCounts={pendingCounts} active="/" />
      <div className="shell-main">
        <div className="only-narrow">
          <TodayView
            health={health}
            brief={brief}
            pending={pending}
            toPost={toPost}
            now={now}
          />
        </div>
        <div className="only-wide">
          <OverviewView
            health={health}
            agents={agents}
            pendingCounts={pendingCounts}
            lastRun={lastRun}
            agentTotals={agentTotals}
            last7={last7}
            todayCost={todayCost}
            todayRuns={todayRuns}
            last7Cost={last7Cost}
            last7Runs={last7Runs}
            grandTotalCost={grandTotalCost}
            totalRuns={runEvents.length}
            recent={recent}
            now={now}
          />
        </div>
      </div>
    </div>
  );
}
