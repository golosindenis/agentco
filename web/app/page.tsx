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
import { deriveHealth, type HealthState } from "../../src/health.js";
import { totalsByAgent, totalsByDay } from "../../src/costs.js";
import { MAX_PENDING_DRAFTS } from "../../src/capacity.js";
import { PROMOTE_AFTER } from "../../src/ladder.js";
import { VerdictForms } from "./VerdictForms";
import { CopyButton } from "./CopyButton";
import { MarkPostedForm } from "./MarkPostedForm";
import { money, timeAgo, fmtDateTime, fmtTime } from "./format";
import { summarizeDetail, detailTone } from "./eventDetail";

// This page reads live database state on every request — it's an
// operations surface, not marketing content, and a cached "did it run?"
// banner would defeat the entire point of the page.
export const dynamic = "force-dynamic";

const HEALTH_LABEL: Record<HealthState, string> = {
  healthy: "Healthy",
  nothing_ran_today: "Nothing ran today",
  something_failed: "Something failed",
};

export default async function DashboardPage() {
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
  const totalsByAgentName = new Map(agentTotals.map((t) => [t.agent, t]));
  const today = totalsByDay(runEvents, 1, now);
  const last7 = totalsByDay(runEvents, 7, now);
  const todayCost = today[0]?.totalCostUsd ?? 0;
  const todayRuns = today[0]?.runs ?? 0;
  const last7Cost = last7.reduce((sum, d) => sum + d.totalCostUsd, 0);
  const last7Runs = last7.reduce((sum, d) => sum + d.runs, 0);
  const grandTotalCost = agentTotals.reduce((sum, t) => sum + t.totalCostUsd, 0);

  return (
    <main className="wrap">
      <div className="top">
        <h1>agentco — control room</h1>
        <span className="sub">
          Refreshed {fmtDateTime(now.toISOString())} · local only · reads live Supabase state
        </span>
      </div>

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
            const atMaxLevel = agent.level >= Math.min(4, agent.max_level);

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

                <div className="ladder" title={`Level ${agent.level} of 4`}>
                  {[1, 2, 3, 4].map((seg) => (
                    <div key={seg} className={`seg${seg <= agent.level ? " filled" : ""}`} />
                  ))}
                </div>

                <div className="meta-row">
                  <span>Level {agent.level}/4</span>
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
        <h2>Waiting on you <span className="count">{pending.length}</span></h2>
        {pending.length === 0 ? (
          <p className="empty">Nothing waiting. Every draft has a verdict.</p>
        ) : (
          pending.map((d) => (
            <div className="draft-card" key={d.id}>
              <div className="draft-head">
                <strong>{d.agentName}</strong>
                <span>
                  level {d.agentLevel} · drafted {fmtDateTime(d.createdAt)} ({timeAgo(d.createdAt, now)})
                </span>
              </div>
              <div className="draft-body">{d.body}</div>
              <VerdictForms draftId={d.id} agentId={d.agentId} body={d.body} />
            </div>
          ))
        )}
      </section>

      <section className="block">
        <h2>Ready to post <span className="count">{toPost.length}</span></h2>
        <p className="note">
          Approved and not yet posted. Nothing here publishes itself — copy the text, paste it
          wherever it goes, then mark it posted.
        </p>
        {toPost.length === 0 ? (
          <p className="empty">Nothing waiting to post.</p>
        ) : (
          toPost.map((d) => (
            <div className="post-card" key={d.id}>
              <div className="draft-head">
                <strong>{d.agent}</strong>
                <span>approved {timeAgo(d.createdAt, now)}</span>
              </div>
              <div className="draft-body">{d.body}</div>
              <div className="post-actions">
                <CopyButton text={d.body} />
                <MarkPostedForm draftId={d.id} />
              </div>
            </div>
          ))
        )}
      </section>

      <section className="block">
        <h2>Latest brief</h2>
        <p className="note">
          Reading material from the Chief of Staff. Never approved or declined — see the README.
        </p>
        <div className="brief-box">
          {brief ? (
            <>
              <div className="brief-meta">written {fmtDateTime(brief.created_at)} ({timeAgo(brief.created_at, now)})</div>
              <div className="brief-body">{brief.body}</div>
            </>
          ) : (
            <p className="empty">No brief yet.</p>
          )}
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
            <div className="dept">{runEvents.length} run{runEvents.length === 1 ? "" : "s"} recorded</div>
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
                      <td className="num">{money(t.totalCostUsd)}</td>
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

      <footer className="pagefoot">
        agentco control room · reads {"'"}src/db.ts{"'"} directly · no data leaves this machine
      </footer>
    </main>
  );
}
