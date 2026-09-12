import { describe, it, expect } from "vitest";
import { reviewStats, type ReviewRow } from "../src/cadence.js";

const NOW = new Date("2026-09-12T12:00:00.000Z");

/** Hours before NOW, as an ISO string. */
const ago = (hours: number) =>
  new Date(NOW.getTime() - hours * 3_600_000).toISOString();

describe("reviewStats", () => {
  it("reports nothing measured, not zero, when there are no drafts", () => {
    const stats = reviewStats([], NOW);
    expect(stats.eligible).toBe(0);
    // The whole point: null renders as "no drafts yet". A 0 here would be
    // indistinguishable from "you reviewed none of them", which is the
    // opposite conclusion.
    expect(stats.rate).toBeNull();
    expect(stats.medianHours).toBeNull();
  });

  it("distinguishes a real zero from nothing measured", () => {
    // Three old drafts, none ever reviewed. This is the failure the panel
    // exists to detect, and it must NOT look like the empty case above.
    const rows: ReviewRow[] = [
      { createdAt: ago(48), reviewedAt: null },
      { createdAt: ago(72), reviewedAt: null },
      { createdAt: ago(96), reviewedAt: null },
    ];
    const stats = reviewStats(rows, NOW);
    expect(stats.eligible).toBe(3);
    expect(stats.reviewedWithinDay).toBe(0);
    expect(stats.rate).toBe(0);
    expect(stats.medianHours).toBeNull(); // nothing reviewed, nothing to median
  });

  it("excludes drafts too young to have failed yet", () => {
    // Produced by this morning's run. Not reviewing it yet is not a miss.
    const rows: ReviewRow[] = [{ createdAt: ago(2), reviewedAt: null }];
    const stats = reviewStats(rows, NOW);
    expect(stats.eligible).toBe(0);
    expect(stats.rate).toBeNull();
  });

  it("counts an old still-pending draft as eligible and not reviewed", () => {
    const rows: ReviewRow[] = [{ createdAt: ago(72), reviewedAt: null }];
    const stats = reviewStats(rows, NOW);
    expect(stats.eligible).toBe(1);
    expect(stats.reviewedWithinDay).toBe(0);
    expect(stats.rate).toBe(0);
  });

  it("counts a review at 23h and rejects one at 25h", () => {
    const rows: ReviewRow[] = [
      { createdAt: ago(48), reviewedAt: ago(48 - 23) },
      { createdAt: ago(96), reviewedAt: ago(96 - 25) },
    ];
    const stats = reviewStats(rows, NOW);
    expect(stats.eligible).toBe(2);
    expect(stats.reviewedWithinDay).toBe(1);
    expect(stats.rate).toBeCloseTo(0.5);
  });

  it("drops drafts older than the fortnight window", () => {
    const rows: ReviewRow[] = [
      { createdAt: ago(15 * 24), reviewedAt: null },
      { createdAt: ago(48), reviewedAt: ago(47) },
    ];
    const stats = reviewStats(rows, NOW);
    expect(stats.eligible).toBe(1);
    expect(stats.rate).toBe(1);
  });

  it("medians the hours over reviewed drafts only", () => {
    const rows: ReviewRow[] = [
      { createdAt: ago(48), reviewedAt: ago(48 - 2) }, // 2h
      { createdAt: ago(72), reviewedAt: ago(72 - 6) }, // 6h
      { createdAt: ago(96), reviewedAt: null }, // never — must not count as 0h
    ];
    const stats = reviewStats(rows, NOW);
    expect(stats.eligible).toBe(3);
    // Even count of reviewed drafts (2 and 6) → midpoint, not a pick.
    expect(stats.medianHours).toBeCloseTo(4);
  });

  it("medians an odd number of reviewed drafts", () => {
    const rows: ReviewRow[] = [
      { createdAt: ago(48), reviewedAt: ago(48 - 1) },
      { createdAt: ago(72), reviewedAt: ago(72 - 5) },
      { createdAt: ago(96), reviewedAt: ago(96 - 30) },
    ];
    expect(reviewStats(rows, NOW).medianHours).toBeCloseTo(5);
  });

  it("counts a draft reviewed after the window closed, in the median", () => {
    // Reviewed at 30h: a miss for the rate, but still a real review and so
    // still part of "when you do review, how fast".
    const rows: ReviewRow[] = [{ createdAt: ago(96), reviewedAt: ago(96 - 30) }];
    const stats = reviewStats(rows, NOW);
    expect(stats.reviewedWithinDay).toBe(0);
    expect(stats.medianHours).toBeCloseTo(30);
  });
});
