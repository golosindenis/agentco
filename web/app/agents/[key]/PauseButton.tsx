"use client";

import { useActionState } from "react";
import { toggleAgentPaused, type ActionResult } from "../../actions";

const initial: ActionResult = { ok: true };

/**
 * Pause is the one agent-level control that works with the runner on the
 * Mac: it sets `agents.enabled = false`, and `claim_next_task` already
 * refuses to hand work to a disabled agent, so it takes effect at the next
 * 07:00 run without the Mac needing to be awake now (see setAgentEnabled,
 * src/db.ts).
 */
export function PauseButton({ agentId, enabled }: { agentId: string; enabled: boolean }) {
  const [state, action, pending] = useActionState(async () => {
    const fd = new FormData();
    fd.set("agentId", agentId);
    fd.set("enabled", String(!enabled));
    return toggleAgentPaused(fd);
  }, initial);

  return (
    <form action={action}>
      <button type="submit" className="ghost" disabled={pending}>
        {pending ? "Saving…" : enabled ? "Pause" : "Resume"}
      </button>
      {!state.ok && <span className="err">{state.error}</span>}
    </form>
  );
}
