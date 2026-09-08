"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import {
  approveDraft,
  approveDraftWithEdit,
  declineDraft,
  type ActionResult,
} from "../../actions";

const initial: ActionResult = { ok: true };

/**
 * Approve is the whole point of this screen, so it is one full-width tap
 * with nothing to read first. Edit and Decline expand in place rather than
 * navigating, because leaving the draft to type a reason means losing sight
 * of the thing being judged.
 */
export function DraftActions({ draftId, agentId, body }: { draftId: string; agentId: string; body: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<null | "edit" | "decline">(null);

  const done = (result: ActionResult) => {
    if (result.ok) router.push("/");
    return result;
  };

  const [approveState, approveAction, approving] = useActionState(async () => {
    const fd = new FormData();
    fd.set("draftId", draftId);
    fd.set("agentId", agentId);
    return done(await approveDraft(fd));
  }, initial);

  const [editState, editAction, editing] = useActionState(
    async (_p: ActionResult, fd: FormData) => {
      fd.set("draftId", draftId);
      fd.set("agentId", agentId);
      return done(await approveDraftWithEdit(fd));
    },
    initial,
  );

  const [declineState, declineAction, declining] = useActionState(
    async (_p: ActionResult, fd: FormData) => {
      fd.set("draftId", draftId);
      fd.set("agentId", agentId);
      return done(await declineDraft(fd));
    },
    initial,
  );

  const error =
    (!approveState.ok && approveState.error) ||
    (!editState.ok && editState.error) ||
    (!declineState.ok && declineState.error) ||
    null;

  return (
    <div className="action-bar">
      {error && <p className="err">{error}</p>}

      {open === null && (
        <>
          <form action={approveAction}>
            <button type="submit" className="primary tall" disabled={approving}>
              {approving ? "Approving…" : "Approve"}
            </button>
          </form>
          <div className="action-row">
            <button type="button" onClick={() => setOpen("edit")}>Edit and approve</button>
            <button type="button" className="danger" onClick={() => setOpen("decline")}>Decline</button>
          </div>
        </>
      )}

      {open === "edit" && (
        <form action={editAction} className="inline-form">
          {/* Field name must match what approveDraftWithEdit reads
              (formData.get("editedBody") — see web/app/actions.ts), not
              "body". Getting this wrong means every edit-and-approve
              submits an empty string and is silently rejected as empty. */}
          <textarea name="editedBody" rows={10} defaultValue={body} required />
          <div className="action-row">
            <button type="button" onClick={() => setOpen(null)}>Cancel</button>
            <button type="submit" className="primary" disabled={editing}>
              {editing ? "Saving…" : "Approve edit"}
            </button>
          </div>
        </form>
      )}

      {open === "decline" && (
        <form action={declineAction} className="inline-form">
          <label htmlFor="reason">Why</label>
          <input id="reason" name="reason" type="text" required />
          <p className="hint">This becomes a standing rule for the agent.</p>
          <div className="action-row">
            <button type="button" onClick={() => setOpen(null)}>Cancel</button>
            <button type="submit" className="danger" disabled={declining}>
              {declining ? "Declining…" : "Decline"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
