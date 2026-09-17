import { describe, it, expect } from "vitest";
import { planPosts, type PostSource } from "../src/posting/plan.js";

const now = new Date("2026-09-15T12:00:00Z");
const text: PostSource = { kind: "draft", id: "d1", itemKind: "text", imagePaths: [] };
const photo: PostSource = { kind: "draft", id: "d1", itemKind: "photo", imagePaths: ["photos:2026-09-15/a.jpg"] };

describe("planPosts", () => {
  it("makes one row per ticked account at the chosen time", () => {
    const r = planPosts(photo, [
      { accountId: "fb", platform: "facebook", caption: "Hi" },
      { accountId: "ig", platform: "instagram", caption: "Hi ig" },
    ], now, now, {});
    expect(r).toEqual({
      ok: true,
      rows: [
        { source_kind: "draft", source_id: "d1", account_id: "fb", platform: "facebook", caption: "Hi", image_paths: ["photos:2026-09-15/a.jpg"], scheduled_for: now.toISOString() },
        { source_kind: "draft", source_id: "d1", account_id: "ig", platform: "instagram", caption: "Hi ig", image_paths: ["photos:2026-09-15/a.jpg"], scheduled_for: now.toISOString() },
      ],
    });
  });

  it("collects every problem instead of stopping at the first", () => {
    const r = planPosts(text, [
      { accountId: "ig", platform: "instagram", caption: "Hi" },
      { accountId: "th", platform: "threads", caption: "x".repeat(501) },
    ], now, now, {});
    expect(r).toEqual({ ok: false, errors: ["Instagram: Instagram needs an image", "Threads: Threads allows 500 characters, this has 501"] });
  });

  it("refuses an empty selection and a past time", () => {
    expect(planPosts(text, [], now, now, {})).toEqual({ ok: false, errors: ["Tick at least one account"] });
    expect(planPosts(text, [{ accountId: "fb", platform: "facebook", caption: "Hi" }], new Date("2026-09-15T11:00:00Z"), now, {}))
      .toEqual({ ok: false, errors: ["That time has already passed"] });
  });

  it("refuses an Instagram account already at 25 posts that day", () => {
    const busy = Array.from({ length: 25 }, (_, i) => new Date(now.getTime() + i * 60_000));
    expect(planPosts(photo, [{ accountId: "ig", platform: "instagram", caption: "Hi" }], now, now, { ig: busy }))
      .toEqual({ ok: false, errors: ["Instagram: this account already has 25 posts within 24 hours of that time"] });
  });
});
