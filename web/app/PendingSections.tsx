import Link from "next/link";
import { VerdictForms } from "./VerdictForms";
import { CopyButton } from "./CopyButton";
import { MarkPostedForm } from "./MarkPostedForm";
import { fmtDateTime, timeAgo } from "./format";
import { truncateLines } from "./lib/viewModel";

export type PendingDraft = {
  id: string;
  agentId: string;
  agentName: string;
  agentLevel: number;
  body: string;
  createdAt: string;
};

export type ApprovedDraft = {
  id: string;
  agent: string;
  body: string;
  createdAt: string;
};

/**
 * The three action sections shared verbatim between TodayView (phone) and
 * OverviewView (desktop) — same facts, same components, at different
 * densities. Neither view re-implements verdicts, copy-to-clipboard, or
 * mark-posted; both render these and let the surrounding layout differ.
 */

export function BriefSection({
  brief,
  now,
}: {
  brief: { body: string; created_at: string } | null;
  now: Date;
}) {
  return (
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
  );
}

export function PendingSection({
  pending,
  now,
}: {
  pending: PendingDraft[];
  now: Date;
}) {
  return (
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
            <div className="draft-actions">
              <VerdictForms draftId={d.id} agentId={d.agentId} body={d.body} />
              <Link href={`/drafts/${d.id}`} className="draft-read">Read</Link>
            </div>
          </div>
        ))
      )}
    </section>
  );
}

export function ReadyToPostSection({
  toPost,
  now,
}: {
  toPost: ApprovedDraft[];
  now: Date;
}) {
  return (
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
  );
}
