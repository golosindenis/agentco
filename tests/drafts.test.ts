import { describe, it, expect } from "vitest";
import { shortId, resolveShortId } from "../src/drafts.js";

describe("shortId", () => {
  it("returns the first 8 characters of a uuid", () => {
    expect(shortId("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe("a1b2c3d4");
  });
});

describe("resolveShortId", () => {
  const ids = [
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "b2c3d4e5-f6a7-8901-bcde-f21345678901",
    "c3d4e5f6-a7b8-9012-cdef-321456789012",
  ];

  it("matches a valid unique prefix", () => {
    const result = resolveShortId("b2c3d4e5", ids);
    expect(result).toEqual({ ok: true, id: ids[1] });
  });

  it("matches case-insensitively", () => {
    const result = resolveShortId("B2C3D4E5", ids);
    expect(result).toEqual({ ok: true, id: ids[1] });
  });

  it("returns ok:false with a reason when nothing matches", () => {
    const result = resolveShortId("ffffffff", ids);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected no match");
    expect(result.reason.toLowerCase()).toContain("no");
  });

  it("returns ok:false naming the ambiguity, and does not pick one, when a prefix matches two ids", () => {
    const ambiguousIds = [
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "a1b2c3d5-f6a7-8901-bcde-f21345678901",
    ];
    const result = resolveShortId("a1b2c3d", ambiguousIds);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ambiguous match to not resolve");
    expect(result.reason.toLowerCase()).toContain("a1b2c3d4");
    expect(result.reason.toLowerCase()).toContain("a1b2c3d5");
  });

  it("resolves an exact full-length id", () => {
    const result = resolveShortId(ids[2]!, ids);
    expect(result).toEqual({ ok: true, id: ids[2] });
  });
});
