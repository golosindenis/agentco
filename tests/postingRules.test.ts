import { describe, it, expect } from "vitest";
import {
  canPostTo, checkCaption, dubaiLocalToUtc, checkScheduleTime, withinInstagramLimit,
  CAPTION_LIMITS, INSTAGRAM_DAILY_LIMIT,
} from "../src/posting/rules.js";

describe("canPostTo", () => {
  it("refuses a text post on Instagram with the reason", () => {
    expect(canPostTo({ kind: "text", imageCount: 0 }, "instagram")).toEqual({ ok: false, reason: "Instagram needs an image" });
  });
  it("allows a text post on Facebook and Threads", () => {
    expect(canPostTo({ kind: "text", imageCount: 0 }, "facebook")).toEqual({ ok: true });
    expect(canPostTo({ kind: "text", imageCount: 0 }, "threads")).toEqual({ ok: true });
  });
  it("allows a photo post everywhere", () => {
    for (const p of ["instagram", "facebook", "threads"] as const) {
      expect(canPostTo({ kind: "photo", imageCount: 1 }, p)).toEqual({ ok: true });
    }
  });
  it("refuses carousels over each platform's slide limit instead of cutting them", () => {
    expect(canPostTo({ kind: "carousel", imageCount: 11 }, "instagram")).toEqual({ ok: false, reason: "Instagram allows up to 10 slides, this has 11" });
    expect(canPostTo({ kind: "carousel", imageCount: 10 }, "instagram")).toEqual({ ok: true });
    expect(canPostTo({ kind: "carousel", imageCount: 21 }, "threads")).toEqual({ ok: false, reason: "Threads allows up to 20 slides, this has 21" });
    expect(canPostTo({ kind: "carousel", imageCount: 21 }, "facebook")).toEqual({ ok: true });
  });
});

describe("checkCaption", () => {
  it("enforces Threads' 500 character limit", () => {
    expect(checkCaption("threads", "a".repeat(500))).toEqual({ ok: true });
    expect(checkCaption("threads", "a".repeat(501))).toEqual({ ok: false, reason: "Threads allows 500 characters, this has 501" });
  });
  it("uses Instagram's 2200 limit", () => {
    expect(CAPTION_LIMITS.instagram).toBe(2200);
  });
  it("refuses an empty caption", () => {
    expect(checkCaption("facebook", "   ")).toEqual({ ok: false, reason: "Caption is empty" });
  });
});

describe("dubaiLocalToUtc", () => {
  it("reads the time as Dubai time", () => {
    expect(dubaiLocalToUtc("2026-09-18T18:00").toISOString()).toBe("2026-09-18T14:00:00.000Z");
  });
  it("rejects anything that is not a date and time", () => {
    expect(() => dubaiLocalToUtc("tomorrow")).toThrow("Pick a date and time");
  });
});

describe("checkScheduleTime", () => {
  const now = new Date("2026-09-15T12:00:00Z");
  it("allows now and the future", () => {
    expect(checkScheduleTime(new Date("2026-09-15T12:00:30Z"), now)).toEqual({ ok: true });
  });
  it("refuses a time more than a minute in the past", () => {
    expect(checkScheduleTime(new Date("2026-09-15T11:58:00Z"), now)).toEqual({ ok: false, reason: "That time has already passed" });
  });
});

describe("withinInstagramLimit", () => {
  const when = new Date("2026-09-15T12:00:00Z");
  it("allows a 25th post in 24 hours but not a 26th", () => {
    const hourly = (n: number) => Array.from({ length: n }, (_, i) => new Date(when.getTime() - (i + 1) * 3_000_000));
    expect(withinInstagramLimit(hourly(INSTAGRAM_DAILY_LIMIT - 1), when)).toBe(true);
    expect(withinInstagramLimit(hourly(INSTAGRAM_DAILY_LIMIT), when)).toBe(false);
  });
  it("ignores posts more than 24 hours away", () => {
    const old = Array.from({ length: 30 }, () => new Date(when.getTime() - 25 * 3_600_000));
    expect(withinInstagramLimit(old, when)).toBe(true);
  });
});
