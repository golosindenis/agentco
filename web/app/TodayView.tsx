import type { HealthResult } from "../../src/health.js";
import { BottomNav } from "./BottomNav";
import { HEALTH_LABEL } from "./lib/viewModel";
import {
  BriefSection,
  PendingSection,
  ReadyToPostSection,
  type PendingDraft,
  type ApprovedDraft,
} from "./PendingSections";

/**
 * The phone stack: everything Denis needs to clear the approval queue from
 * a 390px screen, top to bottom, nothing that requires horizontal space.
 * Draft bodies are truncated in `PendingSection` (`truncateLines`) because
 * a full body on a phone pushes the Approve button below the fold — the
 * "Read" link is the way back to the whole thing.
 */
export function TodayView({
  health,
  brief,
  pending,
  toPost,
  now,
}: {
  health: HealthResult;
  brief: { body: string; created_at: string } | null;
  pending: PendingDraft[];
  toPost: ApprovedDraft[];
  now: Date;
}) {
  return (
    <>
      {/* Same `.wrap` every other route uses for its horizontal/top padding
          (org, agents/[key], activity, error, not-found) — this page was the
          one exception, rendering straight into the unpadded `.only-narrow`
          container, so cards ran flush to the screen edges. `BottomNav`
          stays a sibling outside `.wrap`, matching those other routes, so
          the nav bar itself stays full-bleed rather than picking up the
          same side padding. */}
      <div className="wrap">
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

        <BriefSection brief={brief} now={now} />
        <PendingSection pending={pending} now={now} />
        <ReadyToPostSection toPost={toPost} now={now} />
      </div>

      <BottomNav active="/" />
    </>
  );
}
