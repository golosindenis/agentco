import { describe, it, expect } from "vitest";
import { pagesToAccounts, needsThreadsRefresh } from "../src/posting/accounts.js";

describe("pagesToAccounts", () => {
  it("makes a ready Facebook account and a ready Instagram account from a linked Page", () => {
    const out = pagesToAccounts([
      { id: "p1", name: "Attune", access_token: "PT", instagram_business_account: { id: "ig1", username: "attune" } },
    ]);
    expect(out).toEqual([
      { account: { platform: "facebook", handle: "Attune", external_id: "p1", status: "ready", reason: null }, token: "PT" },
      { account: { platform: "instagram", handle: "@attune", external_id: "ig1", status: "ready", reason: null }, token: "PT" },
    ]);
  });

  it("explains a Page with no Instagram as not ready for Instagram", () => {
    const out = pagesToAccounts([{ id: "p2", name: "The Solution", access_token: "PT2" }]);
    expect(out[1]).toEqual({
      account: {
        platform: "instagram", handle: "The Solution (no Instagram)", external_id: "page:p2", status: "not_ready",
        reason: "No Instagram account is linked to this Page, or it is a personal account. Switch it to Creator or Business and link it to the Page.",
      },
      token: "PT2",
    });
  });
});

describe("needsThreadsRefresh", () => {
  const now = new Date("2026-09-15T00:00:00Z");
  it("refreshes inside seven days of expiry", () => {
    expect(needsThreadsRefresh("2026-09-21T00:00:00Z", now)).toBe(true);
  });
  it("leaves a fresh token alone", () => {
    expect(needsThreadsRefresh("2026-11-01T00:00:00Z", now)).toBe(false);
  });
  it("does nothing without an expiry", () => {
    expect(needsThreadsRefresh(null, now)).toBe(false);
  });
});
