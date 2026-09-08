import { notFound, redirect } from "next/navigation";
import {
  getAgentByKey,
  verdictHistory,
  eventsForAgent,
  listAgents,
  pendingDraftCountsByAgent,
  listRunEvents,
} from "../../../../src/db.js";
import { MAX_RULES } from "../../../../src/review.js";
import { PROMOTE_AFTER } from "../../../../src/ladder.js";
import { MAX_PENDING_DRAFTS } from "../../../../src/capacity.js";
import { totalsByAgent } from "../../../../src/costs.js";
import { dueOn } from "../../../../src/schedule.js";
import { AgentLadder } from "../../AgentLadder";
import { Sidebar } from "../../Sidebar";
import { BottomNav } from "../../BottomNav";
import { PauseButton } from "./PauseButton";
import { money, fmtDateTime } from "../../format";
import { summarizeDetail, detailTone } from "../../eventDetail";
import { currentUser } from "../../lib/supabaseServer";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ key: string }> }) {
  // Same in-page guard as page.tsx and drafts/[id]/page.tsx: a Server
  // Component that reads one agent's full instructions and verdict history
  // should not rest on the middleware matcher alone.
  const user = await currentUser();
  if (!user) redirect("/login");

  const { key } = await params;
  // Unlike drafts/[id], `key` is not a uuid-typed database filter — an
  // unknown key is a normal "no row" from getAgentByKey's .maybeSingle(),
  // not a Postgres type error, so no shape validation is needed before the
  // lookup (contrast web/app/lib/isValidUuid.ts, which exists to head off a
  // raw database error on the draft route, not this one).
  const agent = await getAgentByKey(key);
  if (!agent) notFound();

  const [agents, pendingCounts, verdicts, events, runEvents] = await Promise.all([
    listAgents(),
    pendingDraftCountsByAgent(),
    verdictHistory(agent.id, 10),
    eventsForAgent(agent.id, 12),
    listRunEvents(),
  ]);

  // The header's "N of MAX_RULES" count and the rendered row count below it
  // are both on this one screen — deriving both from this single array
  // (rather than the header separately calling src/review.ts's countRules,
  // which parses the same string with its own copy of this split/trim/
  // filter) is what keeps them from being able to disagree if either
  // implementation ever changes on its own.
  const rules = agent.instructions
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  const pending = pendingCounts[agent.id] ?? 0;
  const totals = totalsByAgent(runEvents).find((t) => t.agent === agent.display_name);
  // Same "not measured" distinction OverviewView.tsx makes (see its comment
  // above the agent cards): an agent whose runs all predate cost telemetry
  // has costedRuns === 0 and totalCostUsd === 0, which reads as "$0.0000" —
  // i.e. free — unless called out explicitly. Match Overview's wording so
  // the same state doesn't read two different ways depending on which page
  // Denis is looking at.
  const costedRuns = totals?.costedRuns ?? 0;
  const totalCost = totals?.totalCostUsd ?? 0;
  // Same real-max-level check OverviewView.tsx uses (see its comment there)
  // — an agent already at its ceiling can never promote again, so printing
  // "{streak} of {PROMOTE_AFTER}" implies a promotion that cannot happen.
  const atMaxLevel = agent.level >= agent.max_level;
  // listRunEvents()/totalsByAgent has no date filter — it's an all-time
  // total, the same figure `/` shows as "Total cost (list-price)". This
  // page used to label it "Cost, month", which is a different number than
  // what's actually computed; fixing the label (not adding a date-filtered
  // query) to match how `/` already describes the same figure.
  const scheduledToday = dueOn(new Date()).some((t) => t.agentKey === agent.key);

  return (
    <div className="shell">
      <Sidebar agents={agents} pendingCounts={pendingCounts} active={`/agents/${key}`} />
      <div className="shell-main">
        <main className="wrap">
          <div className="top">
            <div>
              <h1>{agent.display_name}</h1>
              <span className="sub">
                {agent.department} · {agent.turn_cap} turn cap
                {agent.enabled ? "" : " · paused"}
              </span>
            </div>
            <div className="head-actions">
              {/* "Next run 07:00" was always shown for any enabled agent,
                  which is wrong six days out of seven for the Strategist
                  (src/schedule.ts's dueOn() only queues its weekly_angles
                  on Mondays) — and even on a day a task is queued, this app
                  has no way to confirm the LaunchAgent actually fired.
                  "Scheduled today" says only what dueOn() actually knows;
                  it does not claim the run happened or will happen. */}
              <span className="sub">
                {agent.enabled
                  ? scheduledToday
                    ? "Scheduled today, 07:00"
                    : "Not scheduled today"
                  : "Paused"}
              </span>
              <PauseButton agentId={agent.id} enabled={agent.enabled} />
            </div>
          </div>

          <div className="cost-summary">
            <div className="stat">
              <div className="stat-label">Autonomy</div>
              <AgentLadder level={agent.level} maxLevel={agent.max_level} />
              <div className="stat-sub">
                Level {agent.level} · {agent.can_publish ? "may publish" : "drafts only"}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Streak</div>
              <div className="stat-value">
                {atMaxLevel ? (
                  "(max level)"
                ) : (
                  <>
                    {agent.streak} <span className="of">of {PROMOTE_AFTER}</span>
                  </>
                )}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Pending</div>
              <div className="stat-value">
                {pending} <span className="of">of {MAX_PENDING_DRAFTS}</span>
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Total cost (list-price)</div>
              <div className="stat-value">
                {costedRuns > 0 ? money(totalCost) : "not measured"}
              </div>
            </div>
          </div>

          <section className="block">
            <h2>
              Instructions <span className="count">{rules.length} of {MAX_RULES}</span>
            </h2>
            <div className="feed">
              {rules.map((rule, i) => (
                <div className="rule-row" key={i}>
                  <span className="rule-num">{i + 1}</span>
                  <span>{rule}</span>
                </div>
              ))}
              {rules.length === 0 && <div className="empty">No standing instructions yet.</div>}
            </div>
            <p className="note">
              Declining an agent writes your reason in here, so the correction sticks.
            </p>
          </section>

          <section className="block">
            <h2>Verdict history</h2>
            <table className="data">
              <thead>
                <tr><th>When</th><th>Verdict</th><th>Reason</th></tr>
              </thead>
              <tbody>
                {verdicts.map((v, i) => (
                  <tr key={i}>
                    <td>{fmtDateTime(v.created_at)}</td>
                    <td>{v.verdict}</td>
                    <td>{v.reason ?? "—"}</td>
                  </tr>
                ))}
                {verdicts.length === 0 && (
                  <tr><td colSpan={3} className="empty">No verdicts yet.</td></tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="block">
            <h2>Event log</h2>
            <div className="feed">
              {events.map((e, i) => (
                <div className="feed-row agent-events" key={i}>
                  <span className="time">{fmtDateTime(e.created_at)}</span>
                  <span className={`kind ${detailTone(e.kind)}`}>{e.kind}</span>
                  <span className="detail">{summarizeDetail(e.kind, e.detail)}</span>
                </div>
              ))}
              {events.length === 0 && <div className="empty">Nothing logged yet.</div>}
            </div>
          </section>
        </main>
        <BottomNav active="/org" />
      </div>
    </div>
  );
}
