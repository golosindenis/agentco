import Link from "next/link";
import { redirect } from "next/navigation";
import { listAgents, pendingDraftCountsByAgent } from "../../../src/db.js";
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

  const [agents, pendingCounts] = await Promise.all([
    listAgents(),
    pendingDraftCountsByAgent(),
  ]);
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
                      className={atCap ? "agent-card blocked" : "agent-card"}
                    >
                      <div className="head">
                        <div>
                          <div className="name">{a.display_name}</div>
                          <div className="dept">{a.department}</div>
                        </div>
                        <span className={atCap ? "pending-pill at-cap" : "pending-pill"}>
                          {pending} / {MAX_PENDING_DRAFTS}
                        </span>
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
