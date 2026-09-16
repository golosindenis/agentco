import { describe, it, expect } from "vitest";
import { cronSecretMatches } from "../web/app/api/publish-due/cronAuth.js";

describe("cronSecretMatches", () => {
  it("accepts the exact secret", () => {
    expect(cronSecretMatches("abc123", "abc123")).toBe(true);
  });
  it("refuses a wrong, missing or unconfigured secret", () => {
    expect(cronSecretMatches("abc124", "abc123")).toBe(false);
    expect(cronSecretMatches(null, "abc123")).toBe(false);
    expect(cronSecretMatches("abc123", undefined)).toBe(false);
    expect(cronSecretMatches("", "")).toBe(false);
  });
});
