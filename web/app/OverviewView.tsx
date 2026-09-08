import type { HealthResult } from "../../src/health.js";
import type { AgentRow } from "../../src/types.js";
import type { AgentTotals } from "../../src/costs.js";
import { MAX_PENDING_DRAFTS } from "../../src/capacity.js";
import { PROMOTE_AFTER } from "../../src/ladder.js";
import { money, timeAgo, fmtTime } from "./format";
import { summarizeDetail, detailTone } from "./eventDetail";
import { HEALTH_LABEL } from "./lib/viewModel";
import { AgentLadder } from "./AgentLadder";
import {
  BriefSection,
  PendingSection,
  ReadyToPostSection,
  type PendingDraft,
  type ApprovedDraft,
} from "./PendingSections";

type RecentEvent = {
  id: string;
  kind: string;
  createdAt: string;
  agent: string | null;
  taskKind: string | null;
  detail: Record<string, unknown>;
};

type DayTotal = { date: string; runs: number; totalCostUsd: number };

/**
 * The desktop operations view: the whole fleet at once — agent ladder
 * state, cost telemetry, recent activity. This is what page.tsx rendered
 * before the phone stack existed, moved here unchanged apart from taking
 * its data as props instead of fetching it.
 *
 * It also carries the same action surface TodayView has (brief, pending
 * verdicts, ready-to-post) — the phone and desktop layouts show the same
 * facts at different densities, and approving a draft is not a fact you
 * can leave off the desktop view. These sections reuse the exact same
 * components as TodayView (see PendingSections.tsx); nothing here
 * reimplements verdicts, copy, or mark-posted.
 */
export function OverviewView({
  health,
  brief,
  pending,
  toPost,
  agents,
  pendingCounts,
  lastRun,
  agentTotals,
  last7,
  todayCost,
  todayRuns,
  last7Cost,
  last7Runs,
  grandTotalCost,
  totalRuns,
  recent,
  now,
}: {
  health: HealthResult;
  brief: { body: string; created_at: string } | null;
  pending: PendingDraft[];
  toPost: ApprovedDraft[];
  agents: AgentRow[];
  pendingCounts: Record<string, number>;
  lastRun: Record<string, string>;
  agentTotals: AgentTotals[];
  last7: DayTotal[];
  todayCost: number;
  todayRuns: number;
  last7Cost: number;
  last7Runs: number;
  grandTotalCost: number;
  totalRuns: number;
  recent: RecentEvent[];
  now: Date;
}) {
  const totalsByAgentName = new Map(agentTotals.map((t) => [t.agent, t]));

  return (
    <>
      <section className={`health ${health.state}`}>
        <div className="headline-row">
          <span className="dot" />
          <span className="state-label">{HEALTH_LABEL[health.state]}</span>
          <span className="headline">{health.headline}</span>
        </div>
        <ul className="evidence">
          {health.evidence.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </section>

      <PendingSection pending={pending} now={now} />
      <BriefSection brief={brief} now={now} />
      <ReadyToPostSection toPost={toPost} now={now} />

      <section className="block">
        <h2>The agents <span className="count">{agents.length}</span></h2>
        <div className="agents">
          {agents.map((agent) => {
            const pendingCount = pendingCounts[agent.id] ?? 0;
            const atCap = pendingCount >= MAX_PENDING_DRAFTS;
            const lastRunAt = lastRun[agent.id];
            const totals = totalsByAgentName.get(agent.display_name);
            // An agent whose runs all predate cost telemetry has no cost data,
            // which is not the same as having cost nothing. Showing $0.0000
            // would read as "free" — say "not measured" instead, matching how
            // the costs table below labels uncosted runs.
            const costedRuns = totals?.costedRuns ?? 0;
            const totalCost = totals?.totalCostUsd ?? 0;
            // Was `agent.level >= Math.min(4, agent.max_level)`, hardcoding 4
            // segments regardless of the agent's real ladder length —
            // AgentLadder and org/page.tsx both use max_level directly. That
            // mismatch is exactly what let this card and the ladder below it
            // disagree about how many rungs there are.
            const atMaxLevel = agent.level >= agent.max_level;

            return (
              <div
                key={agent.id}
                className={`agent-card${agent.enabled ? "" : " disabled"}${atCap ? " blocked" : ""}`}
              >
                <div className="head">
                  <div>
                    <div className="name">{agent.display_name}</div>
                    <div className="dept">{agent.department}</div>
                  </div>
                  {!agent.enabled && <span className="badge off">Disabled</span>}
                  {agent.enabled && atCap && <span className="badge blocked">At cap — blocked</span>}
                </div>

                <AgentLadder level={agent.level} maxLevel={agent.max_level} />

                <div className="meta-row">
                  <span>Level {agent.level}/{agent.max_level}</span>
                  <span>
                    Streak{" "}
                    <span className="streak-track" style={{ display: "inline-flex" }}>
                      {Array.from({ length: PROMOTE_AFTER }).map((_, i) => (
                        <span
                          key={i}
                          className={`streak-dot${i < agent.streak ? " on" : ""}`}
                        />
                      ))}
                    </span>{" "}
                    {atMaxLevel ? "(max level)" : `${agent.streak}/${PROMOTE_AFTER}`}
                  </span>
                </div>

                <div className="meta-row">
                  <span>Pending drafts</span>
                  <span className={`pending-pill${atCap ? " at-cap" : ""}`}>
                    {pendingCount} / {MAX_PENDING_DRAFTS}
                  </span>
                </div>

                <div className="meta-row">
                  <span>Last ran</span>
                  <strong>{lastRunAt ? timeAgo(lastRunAt, now) : "never"}</strong>
                </div>

                <div className="meta-row">
                  <span>Total cost (list-price)</span>
                  <strong>
                    {costedRuns > 0 ? money(totalCost) : "not measured"}
                  </strong>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="block">
        <h2>Costs</h2>
        <p className="note">
          List-price equivalents (costBasis: &quot;list&quot;), not a bill — Denis runs these agents on
          a Claude subscription and is not charged per run. Useful for comparing agents and for
          knowing what the same work would cost on the API.
        </p>

        <div className="cost-summary">
          <div className="stat">
            <div className="stat-label">Today</div>
            <div className="stat-value">{money(todayCost)}</div>
            <div className="dept">{todayRuns} run{todayRuns === 1 ? "" : "s"}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Last 7 days</div>
            <div className="stat-value">{money(last7Cost)}</div>
            <div className="dept">{last7Runs} run{last7Runs === 1 ? "" : "s"}</div>
          </div>
          <div className="stat">
            <div className="stat-label">All time</div>
            <div className="stat-value">{money(grandTotalCost)}</div>
            <div className="dept">{totalRuns} run{totalRuns === 1 ? "" : "s"} recorded</div>
          </div>
        </div>

        <div className="cost-tables">
          <div>
            <table className="data">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Runs</th>
                  <th>Total cost</th>
                  <th>Avg/run</th>
                  <th>Output tok</th>
                </tr>
              </thead>
              <tbody>
                {agentTotals.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">No runs recorded yet.</td>
                  </tr>
                ) : (
                  agentTotals.map((t) => (
                    <tr key={t.agent}>
                      <td>{t.agent}</td>
                      <td className="num">
                        {t.runs}
                        {t.runs > t.costedRuns ? ` (${t.runs - t.costedRuns} uncosted)` : ""}
                      </td>
                      {/* Same "not measured" guard the agent card above already
                          applies — costedRuns === 0 means nothing here is
                          priced, not that it cost $0. Without this, this row
                          printed "$0.0000" for the exact agent the card just
                          called "not measured", contradicting it on the same
                          screen. avgCostUsd already carries its own null
                          (costedRuns === 0) from totalsByAgent, worded "n/a"
                          to match the CLI's cost report (scripts/costs.ts). */}
                      <td className="num">{t.costedRuns > 0 ? money(t.totalCostUsd) : "not measured"}</td>
                      <td className="num">{t.avgCostUsd === null ? "n/a" : money(t.avgCostUsd)}</td>
                      <td className="num">{t.outputTokens.toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div>
            <table className="data">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Runs</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {last7.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="empty">No runs in the last 7 days.</td>
                  </tr>
                ) : (
                  last7.map((d) => (
                    <tr key={d.date}>
                      <td>{d.date}</td>
                      <td className="num">{d.runs}</td>
                      <td className="num">{money(d.totalCostUsd)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="block">
        <h2>Recent activity <span className="count">last {recent.length}</span></h2>
        <div className="feed">
          {recent.length === 0 ? (
            <p className="empty">No events recorded yet.</p>
          ) : (
            recent.map((e) => (
              <div className="feed-row" key={e.id}>
                <span className="time">{fmtTime(e.createdAt)}</span>
                <span className="agent">{e.agent ?? "—"}</span>
                <span className={`kind ${detailTone(e.kind)}`}>
                  {e.kind}
                  {e.taskKind ? ` · ${e.taskKind}` : ""}
                </span>
                <span className="detail">{summarizeDetail(e.kind, e.detail)}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}
