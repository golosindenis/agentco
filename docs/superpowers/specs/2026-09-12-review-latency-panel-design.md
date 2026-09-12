# Review latency panel — design

**Date:** 2026-09-12
**Status:** approved, not yet implemented

## Why this exists

The cloud runner was deliberately not built. The condition written into the
2026-09-08 spec is that it gets built only if **drafts are reviewed within a day
of being produced, sustained over two weeks** — the reasoning being that if that
stays near zero now the app is phone-first, then the interface was never the
bottleneck and more agents would be the wrong response.

Phone login started working 2026-09-12. Without this panel that two-week
question gets answered from memory, which means it gets answered from mood. The
data to answer it properly already exists; nothing here collects anything new.

## What it measures

**Share of drafts reviewed within 24 hours of being produced, over the trailing
14 days**, plus the median hours to review.

Three decisions that change what the number means:

**Only drafts that have had their chance.** The window is drafts created between
14 days and 24 hours ago. A draft produced by this morning's 07:00 run has not
failed to be reviewed — it is young. Including it would drag the figure down
every morning and recover every evening, making the metric read as noise. A
draft older than 24 hours that is still pending counts as a miss, which is
correct: that is exactly the failure being watched for.

**The denominator is shown, never just the percentage.** Four drafts in a
fortnight makes "50%" a statement about two events. The decision it feeds is
worth ~$30/month, so the sample size travels with the number.

**An empty window reads "no drafts yet", never "0%".** This is the existing
unmeasured-cost rule applied to a second surface — a figure that looks like a
measurement but is really an absence. That rule has regressed three times in
this repo, so here it is enforced by the return type: `reviewStats` returns
`null` for the rate when there is nothing in the window, and the page branches
on null rather than formatting a zero.

Median, not mean: one draft left for nine days should not make a fortnight of
same-hour reviews look bad. The median answers "when I review, how fast", which
is a different question from "do I review at all", and both matter.

## Architecture

> Named `cadence.ts`, not `review.ts`: `src/review.ts` already exists and holds
> `recordVerdict`, the verdict engine. Overloading the word would put "record a
> verdict" and "measure how fast verdicts happen" behind one name.

Mirrors `src/costs.ts` exactly — a Supabase fetch that does no arithmetic, and a
pure module that does arithmetic with no network.

- **`src/db.ts` — `draftReviewTimes(sinceDays)`**
  Returns `{ createdAt: string; reviewedAt: string | null }[]` for drafts created
  in the last `sinceDays` days. Joins `approvals` on `draft_id`; `reviewedAt` is
  the EARLIEST approval row's `created_at`, not the latest — a draft re-decided
  later was still reviewed the first time. Null when no approval row exists.
  Lives in `db.ts` because every query in this project does ("one source of
  truth").

- **`src/cadence.ts` — `reviewStats(rows, now)` (new module, pure)**
  ```ts
  export type ReviewRow = { createdAt: string; reviewedAt: string | null };
  export type ReviewStats = {
    eligible: number;              // drafts old enough to judge
    reviewedWithinDay: number;
    rate: number | null;           // null when eligible === 0
    medianHours: number | null;    // null when nothing was reviewed at all
  };
  ```
  Applies the window (older than 24h, newer than 14d), counts, and computes the
  median over reviewed drafts only. No clock read of its own — `now` is passed
  in, same as `deriveHealth`.

- **`web/app/org/page.tsx`**
  One block above the departments. Renders what `reviewStats` returns and
  branches on the nulls. No arithmetic in the component.

## Testing

`src/cadence.ts` gets real unit tests, no database:

- empty input → `rate: null`, renders as "no drafts yet"
- a draft created 2 hours ago is excluded from `eligible` entirely
- a draft 3 days old and still pending counts as eligible and NOT reviewed
- a draft reviewed at 23h counts, one reviewed at 25h does not
- a draft with two approval rows uses the earliest
- median over an even number of reviewed drafts
- all drafts eligible but none reviewed → `rate: 0` (a real zero, distinct from
  the null above — this is the case the whole panel exists to detect)

That last pair is the point of the module: `0` and `null` must never render the
same way.

## Out of scope

No sparkline, no per-agent breakdown, no configurable window, no new tables, no
migration. If any of those are wanted in two weeks, wanting them will be obvious.
