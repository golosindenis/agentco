import { redirect } from "next/navigation";
import { recentEvents, listAgents, pendingDraftCountsByAgent } from "../../../src/db.js";
import { currentUser } from "../lib/supabaseServer";
import { Sidebar } from "../Sidebar";
import { BottomNav } from "../BottomNav";
import { fmtDateTime } from "../format";
import { summarizeDetail, detailTone } from "../eventDetail";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  // Same in-page guard as page.tsx, drafts/[id]/page.tsx and
  // agents/[key]/page.tsx: the middleware matcher already covers this
  // route, but a Server Component reading the full recent-events feed
  // should not rest on routing config alone.
  const user = await currentUser();
  if (!user) redirect("/login");

  const [events, agents, pendingCounts] = await Promise.all([
    recentEvents(60),
    listAgents(),
    pendingDraftCountsByAgent(),
  ]);

  return (
    <div className="shell">
      <Sidebar agents={agents} pendingCounts={pendingCounts} active="/activity" />
      <div className="shell-main">
        <main className="wrap">
          <div className="top">
            <h1>Activity</h1>
            <span className="sub">Last {events.length} events</span>
          </div>
          <div className="feed">
            {events.map((e) => (
              <div className="feed-row" key={e.id}>
                <span className="time">{fmtDateTime(e.createdAt)}</span>
                <span className="agent">{e.agent ?? "—"}</span>
                <span className={`kind ${detailTone(e.kind)}`}>
                  {e.kind}
                  {e.taskKind ? ` · ${e.taskKind}` : ""}
                </span>
                <span className="detail">{summarizeDetail(e.kind, e.detail)}</span>
              </div>
            ))}
            {events.length === 0 && <div className="empty">Nothing logged yet.</div>}
          </div>
        </main>
        <BottomNav active="/activity" />
      </div>
    </div>
  );
}
