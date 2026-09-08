import Link from "next/link";
import type { AgentRow } from "../../src/types.js";
import { groupByDepartment } from "./lib/viewModel";

export function Sidebar({
  agents,
  pendingCounts,
  active,
}: {
  agents: AgentRow[];
  pendingCounts: Record<string, number>;
  active: string;
}) {
  const pendingTotal = Object.values(pendingCounts).reduce((a, b) => a + b, 0);
  const groups = groupByDepartment(agents);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">agentco</div>
      </div>

      <nav className="sidebar-nav">
        <Link href="/" className={active === "/" ? "side-item on" : "side-item"}>
          <span>Overview</span>
          {pendingTotal > 0 && <span className="side-pending">{pendingTotal} waiting</span>}
        </Link>
        <Link href="/activity" className={active === "/activity" ? "side-item on" : "side-item"}>
          Activity
        </Link>
      </nav>

      {groups.map((group) => (
        <div className="sidebar-section" key={group.department}>
          <div className="sidebar-section-head">
            <span>{group.department}</span>
            <span className="num">{group.agents.length}</span>
          </div>
          <div className="sidebar-section-items">
            {group.agents.map((a) => (
              <Link
                key={a.key}
                href={`/agents/${a.key}`}
                className={active === `/agents/${a.key}` ? "side-item on" : "side-item"}
              >
                <span>{a.display_name}</span>
                {(pendingCounts[a.id] ?? 0) > 0 && (
                  <span className="side-pending">{pendingCounts[a.id]}</span>
                )}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
}
