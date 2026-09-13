import type { CarouselRow, TaskState } from "./types.js";

export type CarouselTaskState = { state: TaskState; error: string | null; created_at: string };

export type CarouselView =
  | { state: "none" }
  | { state: "waiting" }
  | { state: "failed"; reason: string }
  | { state: "deck_ready"; slideCount: number; editorHref: string | null }
  | { state: "sent"; slideCount: number };

/**
 * What the draft page shows about its carousel, from the newest carousel task
 * and the newest carousel row. A task that is queued or running always wins,
 * and a failure wins when it is newer than the deck: a retry must not be
 * hidden behind an older deck. `editorUrl` is empty until Plan 2 hosts the
 * editor.
 */
export function carouselView(
  task: CarouselTaskState | null, carousel: CarouselRow | null, editorUrl: string,
): CarouselView {
  if (task && (task.state === "queued" || task.state === "running")) return { state: "waiting" };
  if (task && task.state === "failed" && (!carousel || task.created_at > carousel.created_at)) {
    return { state: "failed", reason: task.error ?? "unknown error" };
  }
  if (!carousel) return { state: "none" };
  const slideCount = carousel.slides.length;
  if (carousel.status === "sent") return { state: "sent", slideCount };
  const base = editorUrl.replace(/\/$/, "");
  return { state: "deck_ready", slideCount, editorHref: base ? `${base}/c/${carousel.id}` : null };
}
