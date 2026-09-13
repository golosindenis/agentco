import { describe, it, expect } from "vitest";
import { carouselView, sentSummary } from "../src/carousel.js";

const carousel = { id: "c1", status: "deck_ready", slides: [{}, {}, {}, {}, {}], created_at: "2026-09-14T09:00:00.000Z" } as any;

describe("carouselView", () => {
  it("offers the button when nothing was ever requested", () => {
    expect(carouselView(null, null)).toEqual({ state: "none" });
  });
  it("says it is waiting for the Mac while the task is queued or running", () => {
    expect(carouselView({ state: "queued", error: null, created_at: "2026-09-14T08:00:00.000Z" }, null)).toEqual({ state: "waiting" });
    expect(carouselView({ state: "running", error: null, created_at: "2026-09-14T08:00:00.000Z" }, null)).toEqual({ state: "waiting" });
  });
  it("shows the failure reason when the latest task failed", () => {
    expect(carouselView({ state: "failed", error: "slide 2 contains a dash", created_at: "2026-09-14T10:00:00.000Z" }, carousel))
      .toEqual({ state: "failed", reason: "slide 2 contains a dash" });
  });
  it("links a ready deck to its studio page", () => {
    expect(carouselView({ state: "done", error: null, created_at: "2026-09-14T08:00:00.000Z" }, carousel))
      .toEqual({ state: "deck_ready", slideCount: 5, studioHref: "/carousels/c1" });
  });
  it("reports sent carousels with their id", () => {
    expect(carouselView({ state: "done", error: null, created_at: "2026-09-14T08:00:00.000Z" }, { ...carousel, status: "sent" }))
      .toEqual({ state: "sent", slideCount: 5, carouselId: "c1" });
  });
});

describe("sentSummary", () => {
  it("summarises the newest sent carousel, so a newer deck cannot hide it", () => {
    expect(sentSummary({ ...carousel, id: "old", status: "sent" })).toEqual({ carouselId: "old", slideCount: 5 });
  });
  it("is null when nothing was ever sent", () => {
    expect(sentSummary(null)).toBeNull();
  });
});
