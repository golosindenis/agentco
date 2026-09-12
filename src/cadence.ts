/**
 * Pure arithmetic for the review-cadence panel. No network, no clock read of
 * its own — `now` is passed in, the same contract as `health.ts`'s
 * `deriveHealth` — so every window boundary is testable without waiting for
 * one to arrive.
 *
 * This exists to answer one question with a number instead of a memory: are
 * drafts being reviewed within a day of being produced? The 2026-09-08 spec
 * makes the cloud runner conditional on that, sustained over a fortnight.
 */

export type ReviewRow = {
  createdAt: string; // ISO
  reviewedAt: string | null; // ISO of the EARLIEST verdict; null if never
};

export type ReviewStats = {
  /** Drafts old enough to judge — created within the window, over a day ago. */
  eligible: number;
  reviewedWithinDay: number;
  /** null when nothing is eligible. Never 0 in that case — see below. */
  rate: number | null;
  /** Median hours to review, over reviewed drafts only. null if none were. */
  medianHours: number | null;
};

const HOUR = 3_600_000;
const WINDOW_DAYS = 14;
const TARGET_HOURS = 24;

/**
 * `rate` is null when nothing is eligible and a number otherwise — including
 * a real 0. The distinction is the entire point of this module: "no drafts
 * were produced" and "every draft was ignored" are opposite conclusions that
 * a single 0% would render identically. The same trap as `avgCostUsd` in
 * costs.ts, and the unmeasured-cost rule in CLAUDE.md that has regressed
 * three times.
 *
 * Drafts younger than `TARGET_HOURS` are excluded rather than counted as
 * misses. This morning's drafts have not failed to be reviewed; they are
 * young. Counting them would sink the figure after every 07:00 run and
 * recover it each evening, turning the metric into a clock.
 */
export function reviewStats(rows: ReviewRow[], now: Date): ReviewStats {
  const t = now.getTime();
  const windowStart = t - WINDOW_DAYS * 24 * HOUR;
  const mustBeOlderThan = t - TARGET_HOURS * HOUR;

  const eligible = rows.filter((r) => {
    const created = Date.parse(r.createdAt);
    return created >= windowStart && created <= mustBeOlderThan;
  });

  const latencies: number[] = [];
  let reviewedWithinDay = 0;

  for (const r of eligible) {
    if (!r.reviewedAt) continue;
    const hours = (Date.parse(r.reviewedAt) - Date.parse(r.createdAt)) / HOUR;
    // A draft reviewed late is still a review: it misses the rate but
    // belongs in the median, which answers the different question of how
    // fast a review is once it happens.
    latencies.push(hours);
    if (hours <= TARGET_HOURS) reviewedWithinDay += 1;
  }

  return {
    eligible: eligible.length,
    reviewedWithinDay,
    rate: eligible.length === 0 ? null : reviewedWithinDay / eligible.length,
    medianHours: median(latencies),
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}
