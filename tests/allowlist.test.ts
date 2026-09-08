import { describe, it, expect } from "vitest";
import { isAllowedEmail } from "../web/app/lib/allowlist.js";

describe("isAllowedEmail", () => {
  it("accepts the configured address", () => {
    expect(isAllowedEmail("denis@example.com", "denis@example.com")).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(isAllowedEmail("  Denis@Example.com ", "denis@example.com")).toBe(true);
  });

  it("rejects any other address", () => {
    expect(isAllowedEmail("someone@else.com", "denis@example.com")).toBe(false);
  });

  it("rejects everything when no address is configured", () => {
    expect(isAllowedEmail("denis@example.com", "")).toBe(false);
    expect(isAllowedEmail("denis@example.com", undefined as unknown as string)).toBe(false);
  });

  it("rejects an empty submission", () => {
    expect(isAllowedEmail("", "denis@example.com")).toBe(false);
    expect(isAllowedEmail("   ", "denis@example.com")).toBe(false);
  });
});
