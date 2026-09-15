import { GraphError } from "./graph.js";
import type { AccountRow, Http, Platform, PostRow, Publisher, PublishResult } from "./types.js";

export const STUCK_AFTER_MS = 15 * 60_000;

export type PublishDeps = {
  failStuck: (now: Date) => Promise<number>;
  claimDue: (limit: number) => Promise<PostRow[]>;
  getAccount: (id: string) => Promise<AccountRow | null>;
  getToken: (accountId: string) => Promise<string | null>;
  signImages: (paths: string[]) => Promise<string[]>;
  markPosted: (id: string, r: PublishResult) => Promise<void>;
  markFailed: (id: string, error: string) => Promise<void>;
  markAccountReconnect: (accountId: string, reason: string) => Promise<void>;
  publishers: Record<Platform, Publisher>;
  http: Http;
};

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * One cron tick. Stuck rows are failed first and never retried automatically,
 * because Meta may already have posted them. Each claimed row is handled on
 * its own so one failure never blocks the rest.
 */
export async function publishDue(deps: PublishDeps, now: Date) {
  const stuck = await deps.failStuck(now);
  const rows = await deps.claimDue(10);
  let posted = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const account = await deps.getAccount(row.account_id);
      if (!account || account.status !== "ready") {
        await deps.markFailed(row.id, `Account not ready: ${account?.reason ?? "account missing"}`);
        failed++;
        continue;
      }
      const token = await deps.getToken(account.id);
      if (!token) {
        await deps.markFailed(row.id, "No token stored for this account. Reconnect it.");
        failed++;
        continue;
      }
      const imageUrls = row.image_paths.length ? await deps.signImages(row.image_paths) : [];
      const result = await deps.publishers[row.platform](
        { externalAccountId: account.external_id, token, caption: row.caption, imageUrls }, deps.http,
      );
      await deps.markPosted(row.id, result);
      posted++;
    } catch (err) {
      failed++;
      const message = messageOf(err);
      if (err instanceof GraphError && err.isAuth) {
        await deps.markAccountReconnect(row.account_id, message);
        await deps.markFailed(row.id, `Reconnect needed: ${message}`);
      } else {
        await deps.markFailed(row.id, message);
      }
    }
  }

  return { claimed: rows.length, posted, failed, stuck };
}
