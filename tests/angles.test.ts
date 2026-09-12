import { describe, it, expect } from "vitest";
import { parseAngles, formatAngles, planAngleVerdict } from "../src/angles.js";

const BANK = `1. [Attune] The fitness industry built almost every program on a body that never has a cycle.

2. [Denis] The hardest feature request is one you can never test on your own body.

3. [agentco] Most products calling themselves agents are chatbots with a longer system prompt.`;

describe("parseAngles", () => {
  it("reads a real bank", () => {
    const angles = parseAngles(BANK)!;
    expect(angles).toHaveLength(3);
    expect(angles[0]!.n).toBe(1);
    expect(angles[0]!.tag).toBe("Attune");
    expect(angles[1]!.tag).toBe("Denis");
    expect(angles[2]!.text).toContain("chatbots");
    // The tag is metadata, not prose — it must not be left in the text or it
    // gets renumbered into the body on a round trip.
    expect(angles[0]!.text.startsWith("[")).toBe(false);
  });

  it("round-trips a bank unchanged", () => {
    expect(formatAngles(parseAngles(BANK)!)).toBe(BANK);
  });

  it("returns null for prose, so 'not a bank' is never confused with 'no angles'", () => {
    expect(parseAngles("Just a post about something.")).toBeNull();
    expect(parseAngles("")).toBeNull();
  });

  it("returns null for a single angle — there is nothing to pick between", () => {
    expect(parseAngles("1. [Attune] Only one here.")).toBeNull();
  });

  it("handles an untagged bank", () => {
    const angles = parseAngles("1. First angle.\n\n2. Second angle.")!;
    expect(angles).toHaveLength(2);
    expect(angles[0]!.tag).toBeNull();
  });
});

describe("formatAngles", () => {
  it("renumbers 1..n after a drop from the middle", () => {
    const kept = parseAngles(BANK)!.filter((a) => a.n !== 2);
    const out = formatAngles(kept);
    expect(out).toMatch(/^1\. \[Attune\]/);
    expect(out).toContain("2. [agentco]");
    expect(out).not.toContain("chatbots with a longer system prompt.\n\n3.");
    // The dropped angle is gone, and the tags of the survivors are intact.
    expect(out).not.toContain("[Denis]");
    expect(parseAngles(out)).toHaveLength(2);
  });

  it("keeps untagged angles untagged", () => {
    const angles = parseAngles("1. First.\n\n2. Second.")!;
    expect(formatAngles(angles)).toBe("1. First.\n\n2. Second.");
  });
});

describe("planAngleVerdict", () => {
  const angles = parseAngles(BANK)!;
  const none = new Set<number>();
  const noReasons = new Map<number, string>();

  it("keeping everything is a plain approve, not an edit", () => {
    // An edit verdict resets the agent's streak. A review that changed
    // nothing must not cost it promotion progress.
    const plan = planAngleVerdict(angles, none, noReasons);
    expect(plan.verdict).toBe("approved");
    expect(plan.body).toBeNull();
  });

  it("dropping some is an edit carrying the renumbered survivors", () => {
    const plan = planAngleVerdict(angles, new Set([2]), new Map([[2, "Invented biography."]]));
    expect(plan.verdict).toBe("approved_with_edit");
    expect(plan.body).toMatch(/^1\. \[Attune\]/);
    expect(plan.body).toContain("2. [agentco]");
    expect(plan.body).not.toContain("[Denis]");
    expect(plan.reason).toBe("Invented biography.");
  });

  it("dropping everything is a decline, not an empty edit", () => {
    const plan = planAngleVerdict(angles, new Set([1, 2, 3]), noReasons);
    expect(plan.verdict).toBe("declined");
    expect(plan.body).toBeNull();
  });

  it("joins the reasons of several dropped angles", () => {
    const plan = planAngleVerdict(
      angles,
      new Set([1, 2]),
      new Map([[1, "Too generic."], [2, "Invented biography."]]),
    );
    expect(plan.reason).toBe("Too generic. Invented biography.");
  });

  it("leaves the reason undefined when every drop was silent", () => {
    const plan = planAngleVerdict(angles, new Set([1]), new Map([[1, "   "]]));
    expect(plan.reason).toBeUndefined();
  });
});
