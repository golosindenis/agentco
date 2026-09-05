import { applyVerdict } from "./ladder.js";
import type { AgentState, Verdict } from "./types.js";

/** Instructions are one rule per non-empty line. */
export function countRules(instructions: string): number {
  return instructions.split("\n").map((l) => l.trim()).filter(Boolean).length;
}

export const MAX_RULES = 30;

/**
 * Appends `rule` as a new line in `instructions`. The rule is normalised to a
 * single line first — newlines and runs of whitespace collapse to single
 * spaces, then the result is trimmed — because countRules counts non-empty
 * lines, and a multi-line reason would otherwise inflate the count and
 * corrupt the cap. Does not add a leading blank line when `instructions` is
 * empty.
 *
 * Duplicate detection compares case-insensitively with internal whitespace
 * collapsed on both sides, so "too salesy", "Too SALESY" and "too   salesy"
 * are all recognised as the same rule — otherwise near-duplicates burn cap
 * capacity on what is really one correction repeated. The comparison is
 * normalise-only: whichever rule is actually stored (existing line, or the
 * new one when it is not a duplicate) keeps its original casing.
 */
export function appendRule(instructions: string, rule: string): string {
  const normalised = rule.replace(/\s+/g, " ").trim();
  const key = normalised.toLowerCase();
  const lines = instructions.split("\n").map((l) => l.trim()).filter(Boolean);
  const isDuplicate = lines.some((l) => l.replace(/\s+/g, " ").toLowerCase() === key);
  if (isDuplicate) return instructions;
  return instructions === "" ? normalised : `${instructions}\n${normalised}`;
}

export type ReviewDeps = {
  loadState: (agentId: string) => Promise<AgentState>;
  saveState: (agentId: string, state: AgentState) => Promise<void>;
  setDraftStatus: (draftId: string, status: "approved" | "declined") => Promise<void>;
  insertApproval: (draftId: string, verdict: Verdict, reason?: string) => Promise<void>;
  insertFeedback: (agentId: string, reason: string) => Promise<void>;
  loadInstructions: (agentId: string) => Promise<string>;
  saveInstructions: (agentId: string, instructions: string) => Promise<void>;
};

export type VerdictResult = {
  state: AgentState;
  /** true when this decline's rule was written into the agent's instructions */
  ruleAppended: boolean;
  /** rule count after this verdict */
  ruleCount: number;
};

export async function recordVerdict(
  deps: ReviewDeps,
  draftId: string,
  agentId: string,
  verdict: Verdict,
  reason?: string,
): Promise<VerdictResult> {
  await deps.insertApproval(draftId, verdict, reason);
  await deps.setDraftStatus(draftId, verdict === "declined" ? "declined" : "approved");

  // A reason that is empty after trimming counts as no reason at all: no
  // feedback row, no rule. Guarding on the trimmed value here (rather than
  // trusting the caller to have trimmed) matters because recordVerdict is
  // exported and callers other than the CLI may not pre-trim.
  const trimmedReason = reason?.trim();

  let ruleAppended = false;
  let ruleCount = 0;

  if (verdict === "declined" && trimmedReason) {
    await deps.insertFeedback(agentId, trimmedReason);

    const instructions = await deps.loadInstructions(agentId);
    const currentCount = countRules(instructions);
    if (currentCount < MAX_RULES) {
      await deps.saveInstructions(agentId, appendRule(instructions, trimmedReason));
      ruleAppended = true;
      ruleCount = currentCount + 1;
    } else {
      ruleCount = currentCount;
    }
  }

  const next = applyVerdict(await deps.loadState(agentId), verdict);
  await deps.saveState(agentId, next);
  return { state: next, ruleAppended, ruleCount };
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
    async loadInstructions(agentId) {
      const { data, error } = await supabase
        .from("agents").select("instructions")
        .eq("id", agentId).single();
      if (error) throw new Error(error.message);
      return data.instructions;
    },
    async saveInstructions(agentId, instructions) {
      const { error } = await supabase.from("agents")
        .update({ instructions }).eq("id", agentId);
      if (error) throw new Error(error.message);
    },
  };
}
