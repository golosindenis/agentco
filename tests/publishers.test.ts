import { describe, it, expect } from "vitest";
import type { Http } from "../src/posting/types.js";
import { GraphError, GRAPH_BASE, THREADS_BASE, parseGraphResponse } from "../src/posting/graph.js";
import { publishFacebook } from "../src/posting/facebook.js";
import { makeInstagramPublisher } from "../src/posting/instagram.js";
import { publishThreads } from "../src/posting/threads.js";

type Call = { url: string; method: string; params: Record<string, string> };

function fakeHttp(responses: Record<string, unknown>[]): { http: Http; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...responses];
  const http: Http = async (url, opts = {}) => {
    calls.push({ url, method: opts.method ?? "GET", params: opts.params ?? {} });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected call ${url}`);
    return next as Record<string, unknown>;
  };
  return { http, calls };
}

const base = { externalAccountId: "123", token: "TOKEN", caption: "Hello" };

describe("parseGraphResponse", () => {
  it("turns a Graph error envelope into a GraphError carrying Meta's message", () => {
    const err = (() => {
      try { parseGraphResponse(400, { error: { message: "Invalid parameter", code: 100, type: "OAuthException" } }); }
      catch (e) { return e as GraphError; }
    })()!;
    expect(err).toBeInstanceOf(GraphError);
    expect(err.message).toBe("Invalid parameter");
    expect(err.isAuth).toBe(false);
  });
  it("flags an expired token as an auth error", () => {
    expect(() => parseGraphResponse(400, { error: { message: "Session has expired", code: 190 } }))
      .toThrow(expect.objectContaining({ isAuth: true }));
  });
  it("names the status when there is no message", () => {
    expect(() => parseGraphResponse(502, {})).toThrow("Meta returned 502 with no error message");
  });
  it("passes a good body through", () => {
    expect(parseGraphResponse(200, { id: "1" })).toEqual({ id: "1" });
  });
});

describe("publishFacebook", () => {
  it("posts text to the Page feed and reads the permalink", async () => {
    const { http, calls } = fakeHttp([{ id: "123_9" }, { permalink_url: "https://facebook.com/p/9" }]);
    const r = await publishFacebook({ ...base, imageUrls: [] }, http);
    expect(calls[0]).toEqual({ url: `${GRAPH_BASE}/123/feed`, method: "POST", params: { message: "Hello", access_token: "TOKEN" } });
    expect(r).toEqual({ externalId: "123_9", permalink: "https://facebook.com/p/9" });
  });
  it("posts one photo through /photos", async () => {
    const { http, calls } = fakeHttp([{ id: "p1", post_id: "123_5" }, { permalink_url: "https://facebook.com/p/5" }]);
    const r = await publishFacebook({ ...base, imageUrls: ["https://img/1"] }, http);
    expect(calls[0]!.url).toBe(`${GRAPH_BASE}/123/photos`);
    expect(calls[0]!.params).toEqual({ url: "https://img/1", caption: "Hello", access_token: "TOKEN" });
    expect(r.externalId).toBe("123_5");
  });
  it("posts several photos as unpublished uploads attached to one feed post", async () => {
    const { http, calls } = fakeHttp([{ id: "a" }, { id: "b" }, { id: "123_7" }, { permalink_url: "https://facebook.com/p/7" }]);
    await publishFacebook({ ...base, imageUrls: ["https://img/1", "https://img/2"] }, http);
    expect(calls[0]!.params.published).toBe("false");
    expect(calls[2]!.url).toBe(`${GRAPH_BASE}/123/feed`);
    expect(calls[2]!.params).toEqual({
      message: "Hello", access_token: "TOKEN",
      "attached_media[0]": JSON.stringify({ media_fbid: "a" }),
      "attached_media[1]": JSON.stringify({ media_fbid: "b" }),
    });
  });
});

describe("Instagram publisher", () => {
  const noSleep = async () => {};

  it("publishes a single image after the container finishes", async () => {
    const { http, calls } = fakeHttp([
      { id: "c1" }, { status_code: "IN_PROGRESS" }, { status_code: "FINISHED" },
      { id: "m1" }, { permalink: "https://instagram.com/p/m1" },
    ]);
    const r = await makeInstagramPublisher({ sleep: noSleep })({ ...base, imageUrls: ["https://img/1"] }, http);
    expect(calls[0]).toEqual({ url: `${GRAPH_BASE}/123/media`, method: "POST", params: { image_url: "https://img/1", caption: "Hello", access_token: "TOKEN" } });
    expect(calls[3]).toEqual({ url: `${GRAPH_BASE}/123/media_publish`, method: "POST", params: { creation_id: "c1", access_token: "TOKEN" } });
    expect(r).toEqual({ externalId: "m1", permalink: "https://instagram.com/p/m1" });
  });

  it("builds a carousel from child containers", async () => {
    const { http, calls } = fakeHttp([
      { id: "k1" }, { id: "k2" }, { id: "parent" }, { status_code: "FINISHED" }, { id: "m2" }, { permalink: "https://instagram.com/p/m2" },
    ]);
    await makeInstagramPublisher({ sleep: noSleep })({ ...base, imageUrls: ["https://img/1", "https://img/2"] }, http);
    expect(calls[0]!.params).toEqual({ image_url: "https://img/1", is_carousel_item: "true", access_token: "TOKEN" });
    expect(calls[2]!.params).toEqual({ media_type: "CAROUSEL", children: "k1,k2", caption: "Hello", access_token: "TOKEN" });
  });

  it("fails with Meta's status when the container errors", async () => {
    const { http } = fakeHttp([{ id: "c1" }, { status_code: "ERROR", status: "Image could not be downloaded" }]);
    await expect(makeInstagramPublisher({ sleep: noSleep })({ ...base, imageUrls: ["https://img/1"] }, http))
      .rejects.toThrow("Instagram could not process the media: Image could not be downloaded");
  });

  it("gives up after the configured tries", async () => {
    const { http } = fakeHttp([{ id: "c1" }, { status_code: "IN_PROGRESS" }, { status_code: "IN_PROGRESS" }]);
    await expect(makeInstagramPublisher({ sleep: noSleep, tries: 2 })({ ...base, imageUrls: ["https://img/1"] }, http))
      .rejects.toThrow("Instagram was still processing the media after 2 checks");
  });

  it("refuses to publish with no image", async () => {
    const { http } = fakeHttp([]);
    await expect(makeInstagramPublisher({ sleep: noSleep })({ ...base, imageUrls: [] }, http)).rejects.toThrow("Instagram needs an image");
  });
});

describe("publishThreads", () => {
  it("publishes a text post", async () => {
    const { http, calls } = fakeHttp([{ id: "c1" }, { id: "t1" }, { permalink: "https://threads.net/t/1" }]);
    const r = await publishThreads({ ...base, imageUrls: [] }, http);
    expect(calls[0]).toEqual({ url: `${THREADS_BASE}/123/threads`, method: "POST", params: { media_type: "TEXT", text: "Hello", access_token: "TOKEN" } });
    expect(calls[1]).toEqual({ url: `${THREADS_BASE}/123/threads_publish`, method: "POST", params: { creation_id: "c1", access_token: "TOKEN" } });
    expect(r).toEqual({ externalId: "t1", permalink: "https://threads.net/t/1" });
  });
  it("publishes one image", async () => {
    const { http, calls } = fakeHttp([{ id: "c1" }, { id: "t1" }, { permalink: null }]);
    await publishThreads({ ...base, imageUrls: ["https://img/1"] }, http);
    expect(calls[0]!.params).toEqual({ media_type: "IMAGE", image_url: "https://img/1", text: "Hello", access_token: "TOKEN" });
  });
  it("publishes a carousel", async () => {
    const { http, calls } = fakeHttp([{ id: "k1" }, { id: "k2" }, { id: "parent" }, { id: "t2" }, { permalink: "https://threads.net/t/2" }]);
    await publishThreads({ ...base, imageUrls: ["https://img/1", "https://img/2"] }, http);
    expect(calls[0]!.params).toEqual({ media_type: "IMAGE", image_url: "https://img/1", is_carousel_item: "true", access_token: "TOKEN" });
    expect(calls[2]!.params).toEqual({ media_type: "CAROUSEL", children: "k1,k2", text: "Hello", access_token: "TOKEN" });
  });
});
