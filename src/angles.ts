/**
 * Parsing and reassembly for a weekly angle bank, so one angle can be dropped
 * from it without retyping the rest.
 *
 * Pure: no database, no clock. The bank's shape is the only thing this knows
 * about, which is what makes every edge case testable — and what let the
 * hand-edit of 2026-09-12 (a regex in a shell one-liner, run against
 * production) become something with tests behind it.
 */

export type Angle = {
  /** Position as written. Recomputed on format, so a drop renumbers cleanly. */
  n: number;
  /** The [Subject] marker, or null for an untagged bank. */
  tag: string | null;
  text: string;
};

const ANGLE = /^(\d+)\.\s*(?:\[([^\]]+)\]\s*)?([\s\S]*)$/;

/**
 * Returns null — not an empty array — when the body is not a bank. A caller
 * must not be able to confuse "this is prose" with "this is a bank containing
 * nothing", because those lead to opposite screens.
 *
 * A single angle is also not a bank: there is nothing to choose between, so
 * the per-angle UI would be a worse way to edit one paragraph than a textarea.
 */
export function parseAngles(body: string): Angle[] | null {
  const blocks = body
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const angles: Angle[] = [];
  for (const block of blocks) {
    const m = ANGLE.exec(block);
    if (!m) return null;
    angles.push({ n: Number(m[1]), tag: m[2] ?? null, text: m[3]!.trim() });
  }

  return angles.length >= 2 ? angles : null;
}

/** Renumbers 1..n and restores the [Tag] markers. Inverse of parseAngles. */
export function formatAngles(angles: Angle[]): string {
  return angles
    .map((a, i) => `${i + 1}. ${a.tag ? `[${a.tag}] ` : ""}${a.text}`)
    .join("\n\n");
}

export type AnglePlan =
  | { verdict: "approved"; body: null; reason: undefined }
  | { verdict: "approved_with_edit"; body: string; reason: string | undefined }
  | { verdict: "declined"; body: null; reason: string | undefined };

/**
 * What a set of keeps and drops means, decided here rather than inside the
 * server action so the three-way rule is testable without a request.
 *
 * Keeping everything is a plain approval with the body untouched — an edit
 * verdict would reset the agent's streak for a review that changed nothing.
 * Dropping everything is a decline, not an edit that empties the draft.
 */
export function planAngleVerdict(
  angles: Angle[],
  droppedNumbers: Set<number>,
  reasons: Map<number, string>,
): AnglePlan {
  const kept = angles.filter((a) => !droppedNumbers.has(a.n));
  const reason =
    angles
      .filter((a) => droppedNumbers.has(a.n))
      .map((a) => (reasons.get(a.n) ?? "").trim())
      .filter(Boolean)
      .join(" ") || undefined;

  if (kept.length === 0) return { verdict: "declined", body: null, reason };
  if (kept.length === angles.length) {
    return { verdict: "approved", body: null, reason: undefined };
  }
  return { verdict: "approved_with_edit", body: formatAngles(kept), reason };
}
