import Link from "next/link";
import { redirect } from "next/navigation";
import { listAgents, pendingDraftCountsByAgent, draftReviewTimes } from "../../../src/db.js";
import { reviewStats } from "../../../src/cadence.js";
import { MAX_PENDING_DRAFTS } from "../../../src/capacity.js";
import { groupByDepartment } from "../lib/viewModel";
import { AgentLadder } from "../AgentLadder";
import { Sidebar } from "../Sidebar";
import { BottomNav } from "../BottomNav";
import { currentUser } from "../lib/supabaseServer";

export const dynamic = "force-dynamic";

export default async function OrgPage() {
  // Same in-page guard as page.tsx and drafts/[id]/page.tsx: this reads
  // the whole agent roster, so it should not rest on the middleware
  // matcher alone.
  const user = await currentUser();
  if (!user) redirect("/login");

  const [agents, pendingCounts, reviewRows] = await Promise.all([
    listAgents(),
    pendingDraftCountsByAgent(),
    draftReviewTimes(14),
  ]);
  const cadence = reviewStats(reviewRows, new Date());
  const groups = groupByDepartment(agents);

  return (
    <div className="shell">
      <Sidebar agents={agents} pendingCounts={pendingCounts} active="/org" />
      <div className="shell-main">
        <main className="wrap">
          <div className="top">
            <h1>Org</h1>
            <span className="sub">
              {agents.length} agents · {groups.length} departments
            </span>
          </div>

          {/* The cloud runner is conditional on this number, not on a
              memory of it — see docs/superpowers/specs/2026-09-12-
              review-latency-panel-design.md. Reads "no drafts yet" rather
              than 0% when nothing is eligible, because "none were produced"
              and "all were ignored" are opposite conclusions. */}
          <div className="cost-summary">
            <div className="stat">
              <div className="stat-label">Reviewed within a day</div>
              <div className="stat-value">
                {cadence.rate === null ? (
                  "no drafts yet"
                ) : (
                  <>
                    {Math.round(cadence.rate * 100)}%{" "}
                    <span className="of">
                      {cadence.reviewedWithinDay} of {cadence.eligible}
                    </span>
                  </>
                )}
              </div>
              <div className="stat-sub">last 14 days</div>
            </div>
            <div className="stat">
              <div className="stat-label">Median time to review</div>
              <div className="stat-value">
                {cadence.medianHours === null
                  ? "not measured"
                  : `${cadence.medianHours < 1
                      ? Math.round(cadence.medianHours * 60) + "m"
                      : Math.round(cadence.medianHours) + "h"}`}
              </div>
              <div className="stat-sub">when a draft does get reviewed</div>
            </div>
          </div>

          {groups.map((group) => (
            <section className="block" key={group.department}>
              <h2>
                {group.department} <span className="count">{group.agents.length}</span>
              </h2>
              <div className="agents">
                {group.agents.map((a) => {
                  const pending = pendingCounts[a.id] ?? 0;
                  const atCap = pending >= MAX_PENDING_DRAFTS;
                  return (
                    <Link
                      href={`/agents/${a.key}`}
                      key={a.id}
                      // `/` already marks a paused agent both ways — the
                      // `.agent-card.disabled` dimming and a "Disabled"
                      // badge — but that's a desktop-only view. On a phone
                      // `/org` IS the agent list, so without this a paused
                      // agent looked identical to a running one here.
                      // Reusing the same `.disabled`/`.badge.off` treatment
                      // `/` already defines rather than inventing a new one.
                      className={`agent-card${a.enabled ? "" : " disabled"}${atCap ? " blocked" : ""}`}
                    >
                      <div className="head">
                        <div>
                          <div className="name">{a.display_name}</div>
                          <div className="dept">{a.department}</div>
                        </div>
                        <div className="head-actions">
                          {!a.enabled && <span className="badge off">Disabled</span>}
                          <span className={atCap ? "pending-pill at-cap" : "pending-pill"}>
                            {pending} / {MAX_PENDING_DRAFTS}
                          </span>
                        </div>
                      </div>
                      <AgentLadder level={a.level} maxLevel={a.max_level} />
                      <div className="meta-row">
                        <span>
                          Level <strong>{a.level}</strong> of {a.max_level}
                        </span>
                        <span>streak {a.streak}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </main>
        <BottomNav active="/org" />
      </div>
    </div>
  );
}
