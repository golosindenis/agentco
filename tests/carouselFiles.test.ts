import { describe, it, expect } from "vitest";
import { expectedPaths, missingSlides, slidePath } from "../src/carouselFiles.js";

describe("carousel image paths", () => {
  it("names a slide by carousel, two digit position and type", () => {
    expect(slidePath("c1", 0, "hook")).toBe("c1/01-hook.png");
    expect(slidePath("c1", 9, "cta")).toBe("c1/10-cta.png");
  });
  it("lists every expected path in slide order", () => {
    expect(expectedPaths("c1", ["hook", "body", "cta"])).toEqual(["c1/01-hook.png", "c1/02-body.png", "c1/03-cta.png"]);
  });
  it("reports missing slides by 1 based number", () => {
    const expected = expectedPaths("c1", ["hook", "body", "cta"]);
    expect(missingSlides(expected, ["c1/01-hook.png", "c1/03-cta.png"])).toEqual([2]);
    expect(missingSlides(expected, expected)).toEqual([]);
  });
});
