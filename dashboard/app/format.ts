/**
 * Presentation-only formatting for the dashboard. Nothing here is logic
 * worth unit-testing on its own (see src/health.ts, src/costs.ts, etc. for
 * the actual decisions) — this just turns numbers and ISO strings into the
 * text the page prints.
 */

export function money(n: number): string {
  return `$${n.toFixed(4)}`;
}

export function timeAgo(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}
