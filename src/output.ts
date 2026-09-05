export type OutputCheck = { ok: true } | { ok: false; reason: string };

/** Shorter than this is an acknowledgement, not a draft. */
export const MIN_DRAFT_CHARS = 20;

/**
 * A run that "succeeds" while producing nothing is the failure mode that hides
 * longest — it looks fine in every log and every dashboard. Every run must
 * prove it produced something usable before it is recorded as done.
 */
export function assertUsableOutput(
  body: string,
  previous: string | null,
): OutputCheck {
  const trimmed = body.trim();

  if (trimmed.length === 0) {
    return { ok: false, reason: "run produced no output" };
  }
  if (trimmed.length < MIN_DRAFT_CHARS) {
    return {
      ok: false,
      reason: `output too short to be a draft (${trimmed.length} chars)`,
    };
  }
  if (previous !== null && trimmed === previous.trim()) {
    return { ok: false, reason: "output identical to the previous draft" };
  }
  return { ok: true };
}
