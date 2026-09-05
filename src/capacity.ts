/**
 * An agent stops producing once it has this many drafts awaiting a verdict.
 *
 * This makes Denis's review capacity throttle the system, rather than letting
 * a backlog build up with his name on it that he then avoids.
 */
export const MAX_PENDING_DRAFTS = 3;

export function canProduce(pendingCount: number): boolean {
  return pendingCount < MAX_PENDING_DRAFTS;
}
