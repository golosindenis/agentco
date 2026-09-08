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
  /**
   * The verdict already recorded for this draft, or null if none has been
   * recorded yet. This carries the verdict itself, not just whether one
   * exists, because a retry must converge the draft's status on what was
   * actually RECORDED, not on whatever the current submission carries — see
   * recordVerdict's doc comment.
   */
  recordedVerdict: (draftId: string) => Promise<Verdict | null>;
};

export type VerdictResult = {
  state: AgentState;
  /** true when this decline's rule was written into the agent's instructions */
  ruleAppended: boolean;
  /** rule count after this verdict */
  ruleCount: number;
  /** true when a verdict for this draft was already recorded before this call */
  alreadyDecided: boolean;
  /**
   * The verdict that was already recorded for this draft going into this
   * call, or null on a first-time verdict. When `alreadyDecided` is true and
   * this differs from the verdict the caller just submitted, the submission
   * was NOT applied — no new approval row, no feedback, no rule, no ladder
   * move — the draft's status was instead reaffirmed from this recorded
   * verdict, and the caller should tell the human their input was discarded.
   */
  recordedVerdict: Verdict | null;
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
 * (double feedback, a second ladder move) — `recordedVerdict` is what makes
 * a retry safe: it is checked once, up front, and that single result gates
 * both the approval/feedback/instructions block and the ladder block below,
 * so a retry does only the one thing that didn't happen last time: setting
 * the draft's status.
 *
 * That gate also has to handle a submission that DIVERGES from what was
 * already recorded — e.g. Denis approves from one tab, then a stale second
 * tab declines the same draft with a reason. That second submission is not
 * a retry of the first; it is a conflicting decision arriving after the
 * fact. What the recorded verdict actually guarantees is narrower than it
 * looks: an approval row exists for it, because the gate above keys on
 * `insertApproval` — the FIRST side effect — as the signal that this verdict
 * was already processed. It does NOT guarantee that feedback, the
 * instruction rule, and the ladder move landed too. If a previous attempt
 * threw between `insertApproval` and `saveState`, those are permanently
 * unapplied — this function has no way to detect or replay just the missing
 * steps, and a retry (matching or divergent) only ever does the one thing
 * left undone here: setting the draft's status. That gap is pre-existing,
 * not introduced by this convergence logic; fixing it for real would mean
 * per-step idempotence (recording which side effects landed, not just
 * whether *an* approval row exists) plus a `unique (draft_id)` constraint on
 * `approvals` so a divergent submission can't insert a second, competing
 * row — both left for a separate change.
 *
 * Given that, the only defensible move here is to leave the recorded
 * verdict's (possibly incomplete) side effects alone and set the draft's
 * status from the RECORDED verdict, not the one just submitted — otherwise
 * the status would flip to "declined" with no approval row backing it,
 * while the typed correction that came with it is silently discarded.
 * `alreadyDecided` / `recordedVerdict` on the result let the caller tell the
 * human that happened, since they cannot otherwise distinguish "recorded"
 * from "silently ignored".
 */
export async function recordVerdict(
  deps: ReviewDeps,
  draftId: string,
  agentId: string,
  verdict: Verdict,
  reason?: string,
): Promise<VerdictResult> {
  const recorded = await deps.recordedVerdict(draftId);
  const alreadyRecorded = recorded !== null;

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

  // Converge on what was actually recorded, not on what was just submitted:
  // on a genuine retry `recorded` equals `verdict`, so this is a no-op
  // change of behaviour; on a divergent second submission it reaffirms the
  // status the recorded verdict actually supports. `recorded` is only ever
  // non-null when `alreadyRecorded` is true, so falling back to `verdict`
  // when it's null is exactly the first-time-verdict case.
  const effectiveVerdict = recorded ?? verdict;
  await deps.setDraftStatus(draftId, effectiveVerdict === "declined" ? "declined" : "approved");
  return { state, ruleAppended, ruleCount, alreadyDecided: alreadyRecorded, recordedVerdict: recorded };
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
    async recordedVerdict(draftId) {
      // Ordered oldest-first with limit(1): normally at most one approval
      // row exists per draft, but if a race ever produced more than one,
      // the oldest is the decision that actually happened first — the one
      // whose approval/feedback/rule/ladder side effects already landed —
      // so it is the one a retry (or a later divergent submission) must
      // converge back onto. `created_at` alone is not a reliable tiebreaker:
      // it defaults to the transaction's start time, `approvals` has no
      // `unique (draft_id)` constraint, and two rows can land in the same
      // instant — so this is not truly "oldest first" without a secondary
      // key. Ordering by `id` next makes the pick deterministic (stable
      // across calls) even though it is not necessarily the row that was
      // inserted first when timestamps tie.
      const { data, error } = await supabase
        .from("approvals")
        .select("verdict")
        .eq("draft_id", draftId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(1);
      if (error) throw new Error(error.message);
      return (data?.[0]?.verdict as Verdict | undefined) ?? null;
    },
  };
}
