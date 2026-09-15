import type { CarouselRow, TaskState } from "./types.js";

export type CarouselTaskState = { state: TaskState; error: string | null; created_at: string };

export type SentSummary = { carouselId: string; slideCount: number };

/**
 * The sent carousel the draft page shows images for. Taken from the newest
 * SENT carousel rather than the newest carousel, so a newer deck that is
 * queued or ready never hides images Denis already sent.
 */
export function sentSummary(lastSent: CarouselRow | null): SentSummary | null {
  return lastSent ? { carouselId: lastSent.id, slideCount: lastSent.slides.length } : null;
}

/** After this many declined decks for one post, a decline stops queuing another. */
export const MAX_DECLINED_DECKS = 3;

/** `declinedCount` includes the decline just recorded. */
export function shouldRequeue(declinedCount: number): boolean {
  return declinedCount < MAX_DECLINED_DECKS;
}

/** Appended to the Producer's prompt so a redo fixes what Denis rejected, rule or not. */
export function declinedDeckNote(reason: string | null): string {
  if (!reason) return "";
  return `\n\n## The last deck for this post was declined\n\nDenis's reason: ${reason}\nMake a new deck that fixes exactly this.`;
}

export type CarouselView =
  | { state: "none" }
  | { state: "waiting" }
  | { state: "failed"; reason: string }
  | { state: "deck_ready"; slideCount: number; studioHref: string }
  | { state: "declined"; reason: string }
  | { state: "rethink"; reason: string; declinedCount: number }
  | { state: "sent"; slideCount: number; carouselId: string };

/**
 * What the draft page shows about its carousel, from the newest carousel task
 * and the newest carousel row. A task that is queued or running always wins,
 * and a failure wins when it is newer than the deck: a retry must not be
 * hidden behind an older deck.
 */
export function carouselView(
  task: CarouselTaskState | null, carousel: CarouselRow | null, declinedCount = 0,
): CarouselView {
  if (task && (task.state === "queued" || task.state === "running")) return { state: "waiting" };
  if (task && task.state === "failed" && (!carousel || task.created_at > carousel.created_at)) {
    return { state: "failed", reason: task.error ?? "unknown error" };
  }
  if (!carousel) return { state: "none" };
  const slideCount = carousel.slides.length;
  if (carousel.status === "sent") return { state: "sent", slideCount, carouselId: carousel.id };
  if (carousel.status === "declined") {
    const reason = carousel.decline_reason ?? "no reason recorded";
    return shouldRequeue(declinedCount) ? { state: "declined", reason } : { state: "rethink", reason, declinedCount };
  }
  return { state: "deck_ready", slideCount, studioHref: `/carousels/${carousel.id}` };
}
