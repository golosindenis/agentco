import { describe, it, expect } from "vitest";
import {
  buildArgs,
  interpretRun,
  runAgent,
  MAX_OUTPUT_CHARS,
} from "../src/runner.js";

const agent = { turn_cap: 8, instructions: "You are a helpful agent." } as any;

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

describe("runAgent process handling", () => {
  it(
    "does not crash the process when the child exits without reading stdin (EPIPE)",
    async () => {
      const uncaught: unknown[] = [];
      const onUncaught = (err: unknown) => uncaught.push(err);
      process.on("uncaughtException", onUncaught);

      try {
        const result = await runAgent(agent, "hello", {
          command: "node",
          args: ["-e", "process.exit(0)"],
        });
        expect(result.ok).toBe(false);
      } finally {
        process.off("uncaughtException", onUncaught);
      }

      expect(uncaught).toEqual([]);
    },
    10_000,
  );

  it(
    "resolves ok:false with a timed-out reason when the child hangs",
    async () => {
      const start = Date.now();
      const result = await runAgent(agent, "hello", {
        command: "node",
        args: ["-e", "setInterval(() => {}, 1000)"],
        timeoutMs: 300,
      });
      const elapsed = Date.now() - start;

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("timed out");
      expect(elapsed).toBeLessThan(5_000);
    },
    10_000,
  );

  it(
    "resolves ok:false with an output-exceeded reason when stdout is unbounded",
    async () => {
      const script = `
        const chunk = "x".repeat(1024);
        const target = ${MAX_OUTPUT_CHARS} * 3;
        let written = 0;
        function write() {
          while (written < target) {
            const ok = process.stdout.write(chunk);
            written += chunk.length;
            if (!ok) { process.stdout.once("drain", write); return; }
          }
        }
        write();
      `;
      const result = await runAgent(agent, "hello", {
        command: "node",
        args: ["-e", script],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("output exceeded");
    },
    10_000,
  );

  it("resolves ok:true with the trimmed stdout on a normal successful run", async () => {
    const result = await runAgent(agent, "hello", {
      command: "node",
      args: ["-e", "console.log('  a draft body  ')"],
    });

    expect(result).toEqual({ ok: true, body: "a draft body" });
  });

  it("resolves exactly once with a could-not-spawn reason when the command does not exist", async () => {
    const resolutions: unknown[] = [];
    const result = await runAgent(agent, "hello", {
      command: "definitely-not-a-real-command-xyz",
      args: [],
    }).then((r) => {
      resolutions.push(r);
      return r;
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("could not spawn");
    expect(resolutions.length).toBe(1);
  });
});
