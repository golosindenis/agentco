import { describe, it, expect } from "vitest";
import { assertUsableOutput } from "../src/output.js";

const good = "Most women think a plateau means they need to train harder.";

describe("assertUsableOutput", () => {
  it("accepts real output", () => {
    expect(assertUsableOutput(good, null)).toEqual({ ok: true });
  });

  it("rejects an empty run", () => {
    const r = assertUsableOutput("", null);
    expect(r.ok).toBe(false);
  });

  it("rejects whitespace only", () => {
    const r = assertUsableOutput("   \n\t ", null);
    expect(r.ok).toBe(false);
  });

  it("rejects output too short to be a draft", () => {
    const r = assertUsableOutput("OK", null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("too short");
  });

  it("rejects output identical to the previous draft", () => {
    const r = assertUsableOutput(good, good);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("identical");
  });

  it("ignores surrounding whitespace when comparing to the previous draft", () => {
    const r = assertUsableOutput(`\n  ${good}  \n`, good);
    expect(r.ok).toBe(false);
  });

  it("accepts output that differs from the previous draft", () => {
    expect(assertUsableOutput(good, "Something else entirely, at length."))
      .toEqual({ ok: true });
  });
});
