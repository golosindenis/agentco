"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import {
  approveDraft,
  approveDraftWithEdit,
  declineDraft,
  submitAngleVerdicts,
  type ActionResult,
} from "../../actions";
import { parseAngles } from "../../../../src/angles.js";

const initial: ActionResult = { ok: true };

/**
 * Approve is the whole point of this screen, so it is one full-width tap
 * with nothing to read first. Edit and Decline expand in place rather than
 * navigating, because leaving the draft to type a reason means losing sight
 * of the thing being judged.
 */
export function DraftActions({ draftId, agentId, body }: { draftId: string; agentId: string; body: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<null | "edit" | "decline" | "angles">(null);
  // A bank gets per-angle keeps and drops; anything else keeps the plain
  // textarea. Detected from the body rather than stored on the draft, so the
  // two can never disagree about what this screen is editing.
  const angles = parseAngles(body);
  const [dropped, setDropped] = useState<Set<number>>(new Set());

  const [anglesState, anglesAction, submittingAngles] = useActionState(
    async (_p: ActionResult, fd: FormData) => {
      fd.set("draftId", draftId);
      fd.set("agentId", agentId);
      fd.set("body", body);
      return done(await submitAngleVerdicts(fd));
    },
    initial,
  );

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
            {angles && (
              <button type="button" onClick={() => setOpen("angles")}>
                Pick angles
              </button>
            )}
            <button type="button" onClick={() => setOpen("edit")}>Edit and approve</button>
            <button type="button" className="danger" onClick={() => setOpen("decline")}>Decline</button>
          </div>
        </>
      )}

      {open === "angles" && angles && (
        <form action={anglesAction} className="inline-form">
          <p className="hint">
            Untick an angle to drop it. The rest are approved and renumbered.
          </p>
          {angles.map((a) => {
            const isDropped = dropped.has(a.n);
            return (
              <div key={a.n} className={`angle-pick${isDropped ? " dropped" : ""}`}>
                <label>
                  <input
                    type="checkbox"
                    defaultChecked
                    onChange={(e) =>
                      setDropped((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.delete(a.n);
                        else next.add(a.n);
                        return next;
                      })
                    }
                  />
                  <span>
                    {a.tag && <strong>[{a.tag}] </strong>}
                    {a.text}
                  </span>
                </label>
                {/* Only a dropped angle submits a `drop` value, so the action
                    reads the checkbox state without needing the inverse. */}
                {isDropped && (
                  <>
                    <input type="hidden" name="drop" value={a.n} />
                    <input
                      name={`reason-${a.n}`}
                      type="text"
                      placeholder="Why (optional)"
                    />
                  </>
                )}
              </div>
            );
          })}
          {dropped.size > 0 && (
            <label className="rule-toggle">
              <input type="checkbox" name="makeRule" />
              <span>Make this a standing rule for the agent</span>
            </label>
          )}
          {!anglesState.ok && <p className="err">{anglesState.error}</p>}
          <div className="action-row">
            <button type="button" onClick={() => setOpen(null)}>Cancel</button>
            <button type="submit" className="primary" disabled={submittingAngles}>
              {submittingAngles
                ? "Saving…"
                : dropped.size === 0
                  ? "Approve all"
                  : `Approve ${angles.length - dropped.size} of ${angles.length}`}
            </button>
          </div>
        </form>
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
