import type { AccountStatus, Platform } from "./types.js";

export type MetaPage = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
};

type Mapped = {
  account: { platform: Platform; handle: string; external_id: string; status: AccountStatus; reason: string | null };
  token: string;
};

export const THREADS_REFRESH_WINDOW_MS = 7 * 86_400_000;

/** A Page token posts for both the Page and its linked Instagram account. */
export function pagesToAccounts(pages: MetaPage[]): Mapped[] {
  const out: Mapped[] = [];
  for (const page of pages) {
    out.push({ account: { platform: "facebook", handle: page.name, external_id: page.id, status: "ready", reason: null }, token: page.access_token });
    const ig = page.instagram_business_account;
    out.push(ig
      ? { account: { platform: "instagram", handle: `@${ig.username ?? ig.id}`, external_id: ig.id, status: "ready", reason: null }, token: page.access_token }
      : {
        account: {
          platform: "instagram", handle: `${page.name} (no Instagram)`, external_id: `page:${page.id}`, status: "not_ready",
          reason: "No Instagram account is linked to this Page, or it is a personal account. Switch it to Creator or Business and link it to the Page.",
        },
        token: page.access_token,
      });
  }
  return out;
}

export function needsThreadsRefresh(expiresAt: string | null, now: Date): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - now.getTime() < THREADS_REFRESH_WINDOW_MS;
}
