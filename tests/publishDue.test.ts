import { describe, it, expect, vi } from "vitest";
import { publishDue, type PublishDeps } from "../src/posting/publish.js";
import { GraphError } from "../src/posting/graph.js";
import type { AccountRow, PostRow } from "../src/posting/types.js";

const post = (over: Partial<PostRow> = {}): PostRow => ({
  id: "p1", source_kind: "draft", source_id: "d1", account_id: "a1", platform: "facebook",
  caption: "Hello", image_paths: ["2026-09-16/x.jpg"], scheduled_for: "2026-09-15T12:00:00Z",
  status: "posting", external_id: null, permalink: null, error: null, attempts: 1,
  claimed_at: "2026-09-15T12:00:00Z", posted_at: null, created_at: "2026-09-15T11:00:00Z", ...over,
});
const account: AccountRow = { id: "a1", platform: "facebook", handle: "attune", external_id: "123", status: "ready", reason: null, token_expires_at: null };

const deps = (over: Partial<PublishDeps> = {}): PublishDeps => ({
  failStuck: vi.fn(async () => 0),
  claimDue: vi.fn(async () => [post()]),
  getAccount: vi.fn(async () => account),
  getToken: vi.fn(async () => "TOKEN"),
  signImages: vi.fn(async (paths: string[]) => paths.map((p) => `https://signed/${p}`)),
  markPosted: vi.fn(async () => {}),
  markFailed: vi.fn(async () => {}),
  markAccountReconnect: vi.fn(async () => {}),
  publishers: {
    facebook: vi.fn(async () => ({ externalId: "123_1", permalink: "https://fb/1" })),
    instagram: vi.fn(async () => ({ externalId: "m", permalink: null })),
    threads: vi.fn(async () => ({ externalId: "t", permalink: null })),
  },
  http: vi.fn(),
  ...over,
});

const now = new Date("2026-09-15T12:00:30Z");

describe("publishDue", () => {
  it("publishes a claimed post with signed images and records the result", async () => {
    const d = deps();
    expect(await publishDue(d, now)).toEqual({ claimed: 1, posted: 1, failed: 0, stuck: 0 });
    expect(d.publishers.facebook).toHaveBeenCalledWith(
      { externalAccountId: "123", token: "TOKEN", caption: "Hello", imageUrls: ["https://signed/2026-09-16/x.jpg"] }, d.http,
    );
    expect(d.markPosted).toHaveBeenCalledWith("p1", { externalId: "123_1", permalink: "https://fb/1" });
  });

  it("fails stuck posts first and reports them", async () => {
    const d = deps({ failStuck: vi.fn(async () => 2), claimDue: vi.fn(async () => []) });
    expect(await publishDue(d, now)).toEqual({ claimed: 0, posted: 0, failed: 0, stuck: 2 });
    expect(d.failStuck).toHaveBeenCalledWith(now);
  });

  it("fails with Meta's message and keeps going to the next post", async () => {
    const d = deps({
      claimDue: vi.fn(async () => [post(), post({ id: "p2" })]),
      publishers: {
        ...deps().publishers,
        facebook: vi.fn()
          .mockRejectedValueOnce(new GraphError("Invalid parameter", 400, 100, false))
          .mockResolvedValueOnce({ externalId: "123_2", permalink: null }),
      },
    });
    expect(await publishDue(d, now)).toEqual({ claimed: 2, posted: 1, failed: 1, stuck: 0 });
    expect(d.markFailed).toHaveBeenCalledWith("p1", "Invalid parameter");
  });

  it("marks the account for reconnection on an auth error", async () => {
    const d = deps({
      publishers: { ...deps().publishers, facebook: vi.fn(async () => { throw new GraphError("Session has expired", 400, 190, true); }) },
    });
    await publishDue(d, now);
    expect(d.markAccountReconnect).toHaveBeenCalledWith("a1", "Session has expired");
    expect(d.markFailed).toHaveBeenCalledWith("p1", "Reconnect needed: Session has expired");
  });

  it("does not call Meta for an account that is not ready", async () => {
    const d = deps({ getAccount: vi.fn(async () => ({ ...account, status: "reconnect_needed" as const, reason: "token expired" })) });
    await publishDue(d, now);
    expect(d.publishers.facebook).not.toHaveBeenCalled();
    expect(d.markFailed).toHaveBeenCalledWith("p1", "Account not ready: token expired");
  });

  it("fails a post whose token is missing", async () => {
    const d = deps({ getToken: vi.fn(async () => null) });
    await publishDue(d, now);
    expect(d.markFailed).toHaveBeenCalledWith("p1", "No token stored for this account. Reconnect it.");
  });
});
