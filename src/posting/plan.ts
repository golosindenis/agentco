import { canPostTo, checkCaption, checkScheduleTime, withinInstagramLimit, type ItemKind } from "./rules.js";
import type { NewPost } from "./store.js";
import type { Platform } from "./types.js";

export type PostSource = { kind: "draft" | "carousel"; id: string; itemKind: ItemKind; imagePaths: string[] };
export type Selection = { accountId: string; platform: Platform; caption: string };

const LABEL: Record<Platform, string> = { instagram: "Instagram", facebook: "Facebook", threads: "Threads" };

export function planPosts(
  source: PostSource, selections: Selection[], when: Date, now: Date, instagramExisting: Record<string, Date[]>,
): { ok: true; rows: NewPost[] } | { ok: false; errors: string[] } {
  if (selections.length === 0) return { ok: false, errors: ["Tick at least one account"] };
  const time = checkScheduleTime(when, now);
  if (!time.ok) return { ok: false, errors: [time.reason] };

  const errors: string[] = [];
  for (const s of selections) {
    const fit = canPostTo({ kind: source.itemKind, imageCount: source.imagePaths.length }, s.platform);
    if (!fit.ok) errors.push(`${LABEL[s.platform]}: ${fit.reason}`);
    const cap = checkCaption(s.platform, s.caption);
    if (!cap.ok) errors.push(`${LABEL[s.platform]}: ${cap.reason}`);
    if (s.platform === "instagram" && !withinInstagramLimit(instagramExisting[s.accountId] ?? [], when)) {
      errors.push("Instagram: this account already has 25 posts within 24 hours of that time");
    }
  }
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    rows: selections.map((s) => ({
      source_kind: source.kind, source_id: source.id, account_id: s.accountId, platform: s.platform,
      caption: s.caption, image_paths: source.imagePaths, scheduled_for: when.toISOString(),
    })),
  };
}
