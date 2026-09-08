import Link from "next/link";
import type { HealthResult } from "../../src/health.js";
import { VerdictForms } from "./VerdictForms";
import { CopyButton } from "./CopyButton";
import { MarkPostedForm } from "./MarkPostedForm";
import { BottomNav } from "./BottomNav";
import { fmtDateTime, timeAgo } from "./format";
import { HEALTH_LABEL, truncateLines } from "./lib/viewModel";

type PendingDraft = {
  id: string;
  agentId: string;
  agentName: string;
  agentLevel: number;
  body: string;
  createdAt: string;
};

type ApprovedDraft = {
  id: string;
  agent: string;
  body: string;
  createdAt: string;
};

/**
 * The phone stack: everything Denis needs to clear the approval queue from
 * a 390px screen, top to bottom, nothing that requires horizontal space.
 * Draft bodies are truncated here (`truncateLines`) because a full body on
 * a phone pushes the Approve button below the fold — the "Read" link is the
 * way back to the whole thing.
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
              <div className="draft-body">{truncateLines(d.body, 4)}</div>
              <VerdictForms draftId={d.id} agentId={d.agentId} body={d.body} />
              <Link href={`/drafts/${d.id}`} className="side-item">Read</Link>
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

      <BottomNav active="/" />
    </>
  );
}
