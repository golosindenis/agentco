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
  /** Whether an approval row already exists for this draft. */
  hasApproval: (draftId: string) => Promise<boolean>;
};

export type VerdictResult = {
  state: AgentState;
  /** true when this decline's rule was written into the agent's instructions */
  ruleAppended: boolean;
  /** rule count after this verdict */
  ruleCount: number;
};

/**
 * Records one human verdict on a draft.
 *
 * Order matters here. The draft's status is set *last*, only after the
 * approval row, feedback, instructions and ladder move have all landed. The
 * old order set the draft's status right after inserting the approval row —
 * so if anything after that (feedback, instructions, or the ladder's
 * loadState/applyVerdict/saveState) threw on a transient Supabase blip, the
 * draft was already retired (approved/declined) and so no longer matched the
 * CLI's `status = 'pending'` query, while the ladder move — the entire
 * mechanic this system runs on — silently never happened, with no way back
 * in. Retiring the draft last means a mid-way failure leaves it `pending`,
 * so the human sees it again and can re-verdict it.
 *
 * That re-verdict must not double-apply the parts that already succeeded
 * (double feedback, a second ladder move) — `hasApproval` is what makes a
 * retry safe: it is checked once, up front, and that single result gates
 * both the approval/feedback/instructions block and the ladder block below,
 * so a retry does only the one thing that didn't happen last time: setting
 * the draft's status.
 */
export async function recordVerdict(
  deps: ReviewDeps,
  draftId: string,
  agentId: string,
  verdict: Verdict,
  reason?: string,
): Promise<VerdictResult> {
  const alreadyRecorded = await deps.hasApproval(draftId);

  let ruleAppended = false;
  let ruleCount = 0;

  if (!alreadyRecorded) {
    await deps.insertApproval(draftId, verdict, reason);

    // A reason that is empty after trimming counts as no reason at all: no
    // feedback row, no rule. Guarding on the trimmed value here (rather than
    // trusting the caller to have trimmed) matters because recordVerdict is
    // exported and callers other than the CLI may not pre-trim.
    const trimmedReason = reason?.trim();

    if (verdict === "declined" && trimmedReason) {
      await deps.insertFeedback(agentId, trimmedReason);

      const instructions = await deps.loadInstructions(agentId);
      const currentCount = countRules(instructions);
      if (currentCount < MAX_RULES) {
        // appendRule dedupes: a reason that already matches an existing rule
        // (case- and whitespace-insensitively) comes back unchanged. Deriving
        // ruleAppended/ruleCount from that actual result — rather than
        // assuming the append always lands whenever under the cap — is what
        // stops a duplicate decline from being reported as newly appended.
        const updated = appendRule(instructions, trimmedReason);
        ruleAppended = updated !== instructions;
        if (ruleAppended) {
          await deps.saveInstructions(agentId, updated);
          ruleCount = countRules(updated);
        } else {
          ruleCount = currentCount;
        }
      } else {
        ruleCount = currentCount;
      }
    }
  }

  let state: AgentState;
  if (!alreadyRecorded) {
    state = applyVerdict(await deps.loadState(agentId), verdict);
    await deps.saveState(agentId, state);
  } else {
    state = await deps.loadState(agentId);
  }

  await deps.setDraftStatus(draftId, verdict === "declined" ? "declined" : "approved");
  return { state, ruleAppended, ruleCount };
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
    async hasApproval(draftId) {
      const { count, error } = await supabase
        .from("approvals")
        .select("id", { count: "exact", head: true })
        .eq("draft_id", draftId);
      if (error) throw new Error(error.message);
      return (count ?? 0) > 0;
    },
  };
}
