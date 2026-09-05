"use client";

import { useActionState, useRef } from "react";
import { approveDraft, approveDraftWithEdit, declineDraft, type ActionResult } from "./actions";

const initial: ActionResult = { ok: true };

/**
 * Approve / Approve-with-edit / Decline for one pending draft.
 *
 * `useActionState` is a React hook, not a state library — it's what lets a
 * failed server action (a transient Supabase error, say) surface inline
 * instead of disappearing into a server console the way an unhandled form
 * action's error would. No data is fetched client-side; the draft's own
 * text arrives as a prop from the server-rendered list in page.tsx.
 *
 * The decline reason is enforced twice: the <input required> stops an empty
 * submit at the browser, and `declineDraft` itself re-checks after trim() —
 * see that action's comment for why the second check can't be skipped.
 */
export function VerdictForms({
  draftId,
  agentId,
  body,
}: {
  draftId: string;
  agentId: string;
  body: string;
}) {
  const [approveResult, approveAction, approvePending] = useActionState(
    async () => {
      const fd = new FormData();
      fd.set("draftId", draftId);
      fd.set("agentId", agentId);
      return approveDraft(fd);
    },
    initial,
  );

  const [editResult, editAction, editPending] = useActionState(
    async (_prev: ActionResult, formData: FormData) => {
      formData.set("draftId", draftId);
      formData.set("agentId", agentId);
      return approveDraftWithEdit(formData);
    },
    initial,
  );

  const [declineResult, declineAction, declinePending] = useActionState(
    async (_prev: ActionResult, formData: FormData) => {
      formData.set("draftId", draftId);
      formData.set("agentId", agentId);
      return declineDraft(formData);
    },
    initial,
  );

  const editDetailsRef = useRef<HTMLDetailsElement>(null);
  const declineDetailsRef = useRef<HTMLDetailsElement>(null);

  return (
    <div className="verdict-row">
      <form action={approveAction}>
        <button type="submit" className="primary" disabled={approvePending}>
          {approvePending ? "Approving…" : "Approve"}
        </button>
      </form>

      <details className="edit-box" ref={editDetailsRef}>
        <summary>
          <span className="btn">Approve with edit</span>
        </summary>
        <form className="inline-form" action={editAction}>
          <textarea name="editedBody" defaultValue={body} rows={5} required />
          <div className="verdict-row">
            <button type="submit" className="primary" disabled={editPending}>
              {editPending ? "Saving…" : "Save edit & approve"}
            </button>
            {editResult.ok === false && <span className="hint">{editResult.error}</span>}
          </div>
        </form>
      </details>

      <details className="decline-box" ref={declineDetailsRef}>
        <summary>
          <span className="btn danger">Decline</span>
        </summary>
        <form className="inline-form" action={declineAction}>
          <input
            type="text"
            name="reason"
            placeholder="One line — what was wrong? (required, teaches the agent)"
            required
          />
          <div className="verdict-row">
            <button type="submit" className="danger" disabled={declinePending}>
              {declinePending ? "Declining…" : "Confirm decline"}
            </button>
            {declineResult.ok === false && <span className="hint">{declineResult.error}</span>}
          </div>
        </form>
      </details>

      {approveResult.ok === false && <span className="hint">{approveResult.error}</span>}
    </div>
  );
}
