# Decline a carousel deck — design

Approved by Denis 2026-09-15. Extends
`2026-09-13-carousel-producer-design.md`.

## Why

The studio could only Send. A weak deck had no way to be rejected, and the
Producer had no way to learn from it. Declines are the only thing that has
ever taught an agent in agentco; approvals teach nothing.

## Decisions Denis made

- A decline queues a new deck immediately.
- Auto-requeue stops after **3 declined decks for one post**. The draft page
  then shows "needs a rethink" and a manual Make another deck button. A manual
  deck that is declined again does not requeue either.
- Decline is available **only before Send**. A sent carousel is history.
- A reason is required. "Make this a rule" is opt-in, off by default, like
  the Writer's per-angle verdicts.

## Flow

1. Studio, deck not sent: Decline opens a box with a required reason and a
   "make this a rule" checkbox.
2. `declineCarousel` action:
   1. Marks the carousel `declined` with `decline_reason` and `declined_at`,
      only if it is still `deck_ready`. This conditional update is the guard
      against a double submit or a stale tab: if it changes no row, nothing
      else happens.
   2. Saves the reason as Producer `feedback`, always.
   3. If the box was ticked, appends the reason through `appendRule`, unless
      the Producer is at `MAX_RULES`, in which case the decline still stands
      and the studio says the rules need consolidating.
   4. Counts declined decks for the post. Under 3: queues a carousel task.
      At 3 or more: queues nothing.
3. The worker, building a carousel prompt, adds the most recent decline
   reason for that post: the redo fixes that exact thing even without a rule.

## Changes

- Migration `0006_carousel_decline.sql`: status check gains `declined`;
  columns `decline_reason text`, `declined_at timestamptz`. No foreign keys.
- `src/carousel.ts`: `MAX_DECLINED_DECKS = 3`, `shouldRequeue`,
  `declinedDeckNote`, and a `declined` / `rethink` state in `carouselView`.
- `src/declineDeck.ts`: `declineCarousel(deps, …)`, pure with injected deps.
- `src/worker.ts`: new dep `latestDeclineReason(sourceDraftId)`.
- `src/db.ts`: `markCarouselDeclined`, `countDeclinedCarousels`,
  `latestDeclineReason`, `insertAgentFeedback`.
- Web: Decline box in `Studio.tsx`, `declineCarousel` server action, declined
  studio renders read-only, draft page shows the rethink state.

Untouched: the Producer's ladder (it publishes nothing), `recordVerdict`
(`approvals` references `drafts`, decks are not drafts).

## Known limit

Steps after the mark are not retried: if saving feedback throws after the
deck is marked declined, the reason is lost for learning (it is still on the
carousel row) and no deck is queued; Make another deck still works. Accepted
over the alternative, where a double submit double-appends feedback.

## Proof of done

Unit tests for the decline logic, the requeue cap, the view states and the
worker prompt. Live DB tests after migration 0006. On production: decline a
real deck with a reason, see the next deck queued and the reason in the
Producer's next prompt; also use Edit text and a sign in round trip.
