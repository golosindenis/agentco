import { describe, it, expect } from "vitest";
import { parseDeck } from "../src/deck.js";

const hook = { type: "hook", text: "Every fitness plan gives women two bad choices", italics: ["two bad choices"], subtext: "Neither of them is a good one." };
const body = (text: string) => ({ type: "body", text, subtext: "A supporting sentence." });
const cta = { type: "cta", text: "That is the whole reason I am building Attune.", italics: ["building Attune"] };
const deck = (slides: unknown[]) => JSON.stringify(slides);
const valid = [hook, body("One"), body("Two"), body("Three"), cta];

describe("parseDeck", () => {
  it("accepts a valid deck", () => {
    const r = parseDeck(deck(valid));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.slides).toHaveLength(5);
  });

  it("accepts a deck wrapped in a json code fence", () => {
    expect(parseDeck("```json\n" + deck(valid) + "\n```").ok).toBe(true);
  });

  it("rejects a hook longer than 10 words, which overflows the slide", () => {
    const long = { ...hook, text: "I built this after watching the women in my life get answers", italics: ["answers"] };
    expect(parseDeck(deck([long, ...valid.slice(1)]))).toEqual({ ok: false, reason: "slide 1 hook has 12 words; max 10" });
  });

  it("accepts a hook of exactly 10 words", () => {
    const ten = { ...hook, text: "Three doctors gave my wife three different shrugs this year", italics: ["three different shrugs"] };
    expect(parseDeck(deck([ten, ...valid.slice(1)])).ok).toBe(true);
  });

  it("rejects non JSON", () => {
    expect(parseDeck("Here is your deck")).toEqual({ ok: false, reason: "output is not valid JSON" });
  });

  it("rejects a non array", () => {
    expect(parseDeck(JSON.stringify({ slides: valid }))).toEqual({ ok: false, reason: "deck must be a JSON array of slides" });
  });

  it("rejects fewer than 5 slides", () => {
    expect(parseDeck(deck([hook, body("One"), cta]))).toEqual({ ok: false, reason: "deck has 3 slides; needs 5 to 10" });
  });

  it("rejects more than 10 slides", () => {
    const many = [hook, ...Array.from({ length: 9 }, (_, i) => body(`Slide ${i}`)), cta];
    expect(parseDeck(deck(many))).toEqual({ ok: false, reason: "deck has 11 slides; needs 5 to 10" });
  });

  it("rejects a first slide that is not a hook", () => {
    expect(parseDeck(deck([body("Zero"), ...valid.slice(1)]))).toEqual({ ok: false, reason: "slide 1 must be a hook" });
  });

  it("rejects a last slide that is not a cta", () => {
    expect(parseDeck(deck([...valid.slice(0, 4), body("End")]))).toEqual({ ok: false, reason: "slide 5 must be a cta" });
  });

  it("rejects a disallowed type", () => {
    const d = [hook, body("One"), { type: "emoji", emoji: "x" }, body("Three"), cta];
    expect(parseDeck(deck(d))).toEqual({ ok: false, reason: "slide 3 has disallowed type emoji" });
  });

  it("rejects an unknown field", () => {
    const d = [hook, body("One"), { ...body("Two"), stickers: [] }, body("Three"), cta];
    expect(parseDeck(deck(d))).toEqual({ ok: false, reason: "slide 3 has unknown field stickers" });
  });

  it("rejects an italics phrase missing from the text", () => {
    const d = [hook, body("One"), { ...body("Two"), italics: ["three"] }, body("Three"), cta];
    expect(parseDeck(deck(d))).toEqual({ ok: false, reason: 'slide 3 italics phrase "three" is not in its text' });
  });

  it("matches italics case insensitively", () => {
    const d = [hook, body("One"), { ...body("Two words"), italics: ["TWO"] }, body("Three"), cta];
    expect(parseDeck(deck(d)).ok).toBe(true);
  });

  it("rejects a highlight missing from the text", () => {
    const d = [hook, body("One"), { ...body("Two"), highlight: "nope" }, body("Three"), cta];
    expect(parseDeck(deck(d))).toEqual({ ok: false, reason: 'slide 3 highlight "nope" is not in its text' });
  });

  it.each(["-", "–", "—"])("rejects the dash %s anywhere, including nested fields", (dash) => {
    const d = [hook, body("One"), { type: "list", text: "List", items: ["fine", `bad ${dash} item`] }, body("Three"), cta];
    expect(parseDeck(deck(d))).toEqual({ ok: false, reason: "slide 3 contains a dash" });
  });
});
