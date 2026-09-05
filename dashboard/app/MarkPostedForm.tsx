"use client";

import { useActionState } from "react";
import { markDraftPosted, type ActionResult } from "./actions";

const initial: ActionResult = { ok: true };

export function MarkPostedForm({ draftId }: { draftId: string }) {
  const [result, action, pending] = useActionState(async () => {
    const fd = new FormData();
    fd.set("draftId", draftId);
    return markDraftPosted(fd);
  }, initial);

  return (
    <form action={action}>
      <button type="submit" className="primary" disabled={pending}>
        {pending ? "Marking…" : "Mark posted"}
      </button>
      {result.ok === false && <span className="hint"> {result.error}</span>}
    </form>
  );
}
