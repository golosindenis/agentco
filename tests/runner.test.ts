import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import {
  buildArgs,
  interpretRun,
  runAgent,
  killChild,
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
      // A pipe buffer is typically ~64KB. To force a real EPIPE we need a
      // prompt far larger than that, plus a child that never reads stdin
      // and exits shortly after starting — otherwise the (synchronous,
      // same-tick) stdin write completes before the child can possibly
      // exit, and the test passes for the wrong reason.
      const bigAgent = {
        ...agent,
        instructions: "x".repeat(512 * 1024),
      };

      const uncaught: unknown[] = [];
      const onUncaught = (err: unknown) => uncaught.push(err);
      process.on("uncaughtException", onUncaught);

      try {
        const result = await runAgent(bigAgent, "hello", {
          command: "node",
          args: ["-e", "setTimeout(() => process.exit(0), 50)"],
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain("stdin error");
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

describe("killChild", () => {
  it(
    "escalates to SIGKILL when the child ignores SIGTERM",
    async () => {
      // Print "ready" only after the SIGTERM handler is installed, and wait
      // for it before signaling — node -e takes tens of ms to boot, and
      // killing before the handler is registered would kill it with the
      // default (fatal) SIGTERM action instead of exercising the escalation.
      const child = spawn("node", [
        "-e",
        "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)",
      ]);

      const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve) => {
          child.on("exit", (code, signal) => resolve({ code, signal }));
        },
      );
      const ready = new Promise<void>((resolve) => {
        child.stdout.once("data", () => resolve());
      });

      await ready;
      killChild(child, 100);

      const { signal } = await exit;
      expect(signal).toBe("SIGKILL");
    },
    10_000,
  );
});
