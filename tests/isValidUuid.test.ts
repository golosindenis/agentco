import { describe, it, expect } from "vitest";
import { isValidUuid } from "../web/app/lib/isValidUuid.js";

describe("isValidUuid", () => {
  it("accepts a well-formed uuid", () => {
    expect(isValidUuid("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(true);
  });

  it("accepts a well-formed uuid regardless of case", () => {
    expect(isValidUuid("A1B2C3D4-E5F6-7890-ABCD-EF1234567890")).toBe(true);
  });

  it("rejects a plainly malformed id", () => {
    expect(isValidUuid("not-a-uuid")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidUuid("")).toBe(false);
  });

  it("rejects a uuid with the wrong segment lengths", () => {
    expect(isValidUuid("a1b2c3d4-e5f6-789-abcd-ef1234567890")).toBe(false);
  });

  it("rejects a uuid missing its hyphens", () => {
    expect(isValidUuid("a1b2c3d4e5f67890abcdef1234567890")).toBe(false);
  });

  it("rejects a valid uuid with trailing garbage", () => {
    expect(isValidUuid("a1b2c3d4-e5f6-7890-abcd-ef1234567890x")).toBe(false);
  });
});
