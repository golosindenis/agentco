import { money } from "./format";

/**
 * Picks the useful parts out of an events.detail blob for the "recent
 * activity" feed, per event kind. See src/worker.ts's `logEvent` calls for
 * the shape each kind actually writes — this only reads fields that exist,
 * never assumes ones that don't.
 */
export function summarizeDetail(kind: string, detail: Record<string, unknown>): string {
  switch (kind) {
    case "draft_created":
    case "brief_created": {
      const cost = typeof detail.costUsd === "number" ? money(detail.costUsd) : "n/a";
      const outTok = typeof detail.outputTokens === "number" ? detail.outputTokens : "?";
      const chars = typeof detail.chars === "number" ? detail.chars : "?";
      const dry = detail.dryRun ? " · dry-run" : "";
      return `${cost} · ${outTok} out tok · ${chars} chars${dry}`;
    }
    case "run_failed":
    case "no_angle_bank":
    case "output_rejected":
      return typeof detail.reason === "string" ? detail.reason : "";
    case "run_crashed":
      return typeof detail.error === "string" ? detail.error : "";
    case "skipped_at_capacity":
      return typeof detail.pending === "number" ? `${detail.pending} pending` : "";
    case "skipped_disabled":
      return "agent is disabled";
    default: {
      const keys = Object.keys(detail);
      if (keys.length === 0) return "";
      try {
        const s = JSON.stringify(detail);
        return s.length > 140 ? s.slice(0, 140) + "…" : s;
      } catch {
        return "";
      }
    }
  }
}

/** Rough severity classification, purely for the feed row's color — never
 * used to decide the health banner itself (that logic lives in
 * src/health.ts and reads task rows, not event kinds). */
export function detailTone(kind: string): "good" | "warn" | "bad" | "" {
  if (kind === "run_crashed" || kind === "run_failed" || kind === "output_rejected") return "bad";
  if (kind.startsWith("skipped_") || kind === "no_angle_bank") return "warn";
  if (kind === "draft_created" || kind === "brief_created") return "good";
  return "";
}
