import { applyVerdict } from "./ladder.js";
import type { AgentState, Verdict } from "./types.js";

/** Instructions are one rule per non-empty line. */
export function countRules(instructions: string): number {
  return instructions.split("\n").map((l) => l.trim()).filter(Boolean).length;
}

export const MAX_RULES = 30;

export type ReviewDeps = {
  loadState: (agentId: string) => Promise<AgentState>;
  saveState: (agentId: string, state: AgentState) => Promise<void>;
  setDraftStatus: (draftId: string, status: "approved" | "declined") => Promise<void>;
  insertApproval: (draftId: string, verdict: Verdict, reason?: string) => Promise<void>;
  insertFeedback: (agentId: string, reason: string) => Promise<void>;
};

export async function recordVerdict(
  deps: ReviewDeps,
  draftId: string,
  agentId: string,
  verdict: Verdict,
  reason?: string,
): Promise<AgentState> {
  await deps.insertApproval(draftId, verdict, reason);
  await deps.setDraftStatus(draftId, verdict === "declined" ? "declined" : "approved");

  if (verdict === "declined" && reason) {
    await deps.insertFeedback(agentId, reason);
  }

  const next = applyVerdict(await deps.loadState(agentId), verdict);
  await deps.saveState(agentId, next);
  return next;
}

/**
 * src/db.ts throws at import time when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 * are absent (by design). Building `liveReviewDeps` as a top-level const would
 * import db.ts as soon as anything imports this module — including
 * tests/review.test.ts, which only wants `recordVerdict` and `countRules` and
 * never touches the database. So `liveReviewDeps` is built lazily here, via a
 * dynamic import, the same arrangement src/worker.ts uses for `buildLiveDeps`.
 */
export async function buildLiveReviewDeps(): Promise<ReviewDeps> {
  const { supabase } = await import("./db.js");
  return {
    async loadState(agentId) {
      const { data, error } = await supabase
        .from("agents").select("level, max_level, streak, recent_verdicts")
        .eq("id", agentId).single();
      if (error) throw new Error(error.message);
      return {
        level: data.level,
        maxLevel: data.max_level,
        streak: data.streak,
        recent: data.recent_verdicts as Verdict[],
      };
    },
    async saveState(agentId, s) {
      const { error } = await supabase.from("agents")
        .update({ level: s.level, streak: s.streak, recent_verdicts: s.recent })
        .eq("id", agentId);
      if (error) throw new Error(error.message);
    },
    async setDraftStatus(draftId, status) {
      const { error } = await supabase.from("drafts")
        .update({ status }).eq("id", draftId);
      if (error) throw new Error(error.message);
    },
    async insertApproval(draftId, verdict, reason) {
      const { error } = await supabase.from("approvals")
        .insert({ draft_id: draftId, verdict, reason: reason ?? null });
      if (error) throw new Error(error.message);
    },
    async insertFeedback(agentId, reason) {
      const { error } = await supabase.from("feedback")
        .insert({ agent_id: agentId, reason });
      if (error) throw new Error(error.message);
    },
  };
}
