import type { Platform } from "./types.js";

export type ItemKind = "text" | "photo" | "carousel";

const LABEL: Record<Platform, string> = { instagram: "Instagram", facebook: "Facebook", threads: "Threads" };

const SLIDE_LIMITS: Partial<Record<Platform, number>> = { instagram: 10, threads: 20 };

export const CAPTION_LIMITS: Record<Platform, number> = { instagram: 2200, facebook: 63206, threads: 500 };

export const INSTAGRAM_DAILY_LIMIT = 25;

type Check = { ok: true } | { ok: false; reason: string };

/** What a platform can take. Over a slide limit is refused, never silently cut. */
export function canPostTo(item: { kind: ItemKind; imageCount: number }, platform: Platform): Check {
  if (platform === "instagram" && item.imageCount === 0) return { ok: false, reason: "Instagram needs an image" };
  const limit = SLIDE_LIMITS[platform];
  if (item.kind === "carousel" && limit !== undefined && item.imageCount > limit) {
    return { ok: false, reason: `${LABEL[platform]} allows up to ${limit} slides, this has ${item.imageCount}` };
  }
  return { ok: true };
}

export function checkCaption(platform: Platform, caption: string): Check {
  if (!caption.trim()) return { ok: false, reason: "Caption is empty" };
  const limit = CAPTION_LIMITS[platform];
  if (caption.length > limit) {
    return { ok: false, reason: `${LABEL[platform]} allows ${limit} characters, this has ${caption.length}` };
  }
  return { ok: true };
}

/** Dubai is UTC+04:00 all year, so a fixed offset is exact. */
export function dubaiLocalToUtc(local: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error("Pick a date and time");
  const d = new Date(`${local}:00+04:00`);
  if (Number.isNaN(d.getTime())) throw new Error("Pick a date and time");
  return d;
}

export function checkScheduleTime(when: Date, now: Date): Check {
  if (when.getTime() < now.getTime() - 60_000) return { ok: false, reason: "That time has already passed" };
  return { ok: true };
}

/** `existing`: scheduled or posted Instagram times for the same account. */
export function withinInstagramLimit(existing: Date[], when: Date): boolean {
  const day = 24 * 3_600_000;
  const near = existing.filter((t) => Math.abs(t.getTime() - when.getTime()) < day).length;
  return near < INSTAGRAM_DAILY_LIMIT;
}
