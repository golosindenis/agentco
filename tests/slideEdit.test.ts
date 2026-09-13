import { describe, it, expect } from "vitest";
import { editSlide, italicsFromLines, italicsToLines, sameShape } from "../src/slideEdit.js";

const slides = [
  { type: "hook", text: "My wife saw three doctors.", italics: ["three doctors"], subtext: "Old line." },
  { type: "body", text: "The fitness industry built one program.", items: ["kept"] },
];

describe("editSlide", () => {
  it("changes one field on one slide and leaves everything else alone", () => {
    const out = editSlide(slides, 0, "text", "Three doctors. Three shrugs.");
    expect(out[0]).toEqual({ ...slides[0], text: "Three doctors. Three shrugs." });
    expect(out[1]).toBe(slides[1]);
    expect(slides[0]!.text).toBe("My wife saw three doctors.");
  });
  it("removes an optional field when it is emptied, instead of saving an empty string", () => {
    const out = editSlide(slides, 0, "subtext", "   ");
    expect("subtext" in out[0]!).toBe(false);
  });
  it("sets italics from a list and removes them when the list is empty", () => {
    expect(editSlide(slides, 1, "italics", ["one program"])[1]).toEqual({ ...slides[1], italics: ["one program"] });
    expect("italics" in editSlide(slides, 0, "italics", [])[0]!).toBe(false);
  });
});

describe("italics lines", () => {
  it("turns one phrase per line into a list, dropping blank lines and edges", () => {
    expect(italicsFromLines("three doctors\n\n  three shrugs  \n")).toEqual(["three doctors", "three shrugs"]);
  });
  it("round trips a list back to lines", () => {
    expect(italicsToLines(["a", "b"])).toBe("a\nb");
    expect(italicsToLines(undefined)).toBe("");
  });
});

describe("sameShape", () => {
  it("accepts edited text on the same slides", () => {
    expect(sameShape(slides, editSlide(slides, 0, "text", "New"))).toBe(true);
  });
  it("refuses a different slide count or a changed type", () => {
    expect(sameShape(slides, slides.slice(0, 1))).toBe(false);
    expect(sameShape(slides, [slides[0]!, { ...slides[1]!, type: "cta" }])).toBe(false);
  });
});
