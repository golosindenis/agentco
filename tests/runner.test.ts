import { describe, it, expect } from "vitest";
import { buildArgs, interpretRun } from "../src/runner.js";

const agent = { turn_cap: 8 } as any;

describe("buildArgs", () => {
  it("passes print mode and the agent's turn cap", () => {
    const args = buildArgs(agent);
    expect(args).toContain("--print");
    expect(args).toContain("--max-turns");
    expect(args[args.indexOf("--max-turns") + 1]).toBe("8");
  });
});

describe("interpretRun", () => {
  it("returns the trimmed stdout on success", () => {
    expect(interpretRun(0, "  a draft body  ", "")).toEqual({
      ok: true, body: "a draft body",
    });
  });

  it("fails on a non-zero exit code and keeps stderr", () => {
    const r = interpretRun(1, "", "boom");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("boom");
  });

  it("fails on a zero exit code with empty stdout", () => {
    const r = interpretRun(0, "   ", "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("no output");
  });
});
