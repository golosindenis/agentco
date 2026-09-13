import { describe, it, expect } from "vitest";
import { safeNext } from "../web/app/lib/safeNext.js";

describe("safeNext", () => {
  it("returns an agentco path, with its query, unchanged", () => {
    expect(safeNext("/drafts/f541f99d-5ecc-49b0-94e8-9bbdbbaedd9b")).toBe("/drafts/f541f99d-5ecc-49b0-94e8-9bbdbbaedd9b");
    expect(safeNext("/carousels/abc?tab=text")).toBe("/carousels/abc?tab=text");
  });

  it("falls back to the dashboard when there is nothing to return to", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("")).toBe("/");
  });

  // A sign-in link must never be usable to land Denis on someone else's site.
  it.each([
    "https://evil.example/drafts",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "drafts/relative",
  ])("refuses %s", (value) => {
    expect(safeNext(value)).toBe("/");
  });

  it("never returns to the login page itself", () => {
    expect(safeNext("/login")).toBe("/");
    expect(safeNext("/login?next=/drafts/x")).toBe("/");
  });
});
