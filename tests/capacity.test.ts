import { describe, it, expect } from "vitest";
import { canProduce, MAX_PENDING_DRAFTS } from "../src/capacity.js";

describe("backpressure", () => {
  it("caps at three pending drafts", () => {
    expect(MAX_PENDING_DRAFTS).toBe(3);
  });

  it("allows production below the cap", () => {
    expect(canProduce(0)).toBe(true);
    expect(canProduce(2)).toBe(true);
  });

  it("stops production at the cap", () => {
    expect(canProduce(3)).toBe(false);
  });

  it("stops production above the cap", () => {
    expect(canProduce(9)).toBe(false);
  });
});
