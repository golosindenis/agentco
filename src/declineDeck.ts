import { shouldRequeue } from "./carousel.js";
import { appendRule, countRules, MAX_RULES } from "./review.js";

export type DeclineDeps = {
  /** Marks the deck declined only if it is still deck_ready; null when it was not. */
  markDeclined: (carouselId: string, reason: string) => Promise<{ sourceDraftId: string } | null>;
  producerId: () => Promise<string>;
  insertFeedback: (agentId: string, reason: string) => Promise<void>;
  loadInstructions: (agentId: string) => Promise<string>;
  saveInstructions: (agentId: string, instructions: string) => Promise<void>;
  /** Declined decks for the post, including the one just marked. */
  countDeclined: (sourceDraftId: string) => Promise<number>;
  queueCarousel: (sourceDraftId: string) => Promise<void>;
};

export type DeclineResult =
  | {
    ok: true; sourceDraftId: string; ruleAppended: boolean; atRuleCap: boolean;
    requeued: boolean; declinedCount: number; requeueError?: string;
  }
  | { ok: false; error: string };

/**
 * Declines a carousel deck before Send. The conditional mark comes first and
 * is the only guard: a double submit or a stale tab changes no row and so
 * does nothing else. A deck is not a draft, so this never touches
 * `approvals` or the ladder. The reason is always feedback; it becomes a
 * standing rule only when asked, and never past MAX_RULES.
 */
export async function declineCarousel(
  deps: DeclineDeps, carouselId: string, reason: string, makeRule: boolean,
): Promise<DeclineResult> {
  const trimmed = reason.replace(/\s+/g, " ").trim();
  if (!trimmed) return { ok: false, error: "Give a reason for declining." };

  const marked = await deps.markDeclined(carouselId, trimmed);
  if (!marked) return { ok: false, error: "This deck was already sent or declined. Reload the page." };

  const producer = await deps.producerId();
  await deps.insertFeedback(producer, trimmed);

  let ruleAppended = false;
  let atRuleCap = false;
  if (makeRule) {
    const instructions = await deps.loadInstructions(producer);
    if (countRules(instructions) >= MAX_RULES) {
      atRuleCap = true;
    } else {
      const updated = appendRule(instructions, trimmed);
      ruleAppended = updated !== instructions;
      if (ruleAppended) await deps.saveInstructions(producer, updated);
    }
  }

  const declinedCount = await deps.countDeclined(marked.sourceDraftId);
  let requeued = false;
  let requeueError: string | undefined;
  if (shouldRequeue(declinedCount)) {
    try {
      await deps.queueCarousel(marked.sourceDraftId);
      requeued = true;
    } catch (err) {
      requeueError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    ok: true, sourceDraftId: marked.sourceDraftId, ruleAppended, atRuleCap, requeued, declinedCount,
    ...(requeueError ? { requeueError } : {}),
  };
}
