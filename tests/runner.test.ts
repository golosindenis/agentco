import { describe, it, expect, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";

// runAgent doesn't expose the ChildProcess it spawns. The regression test
// below needs the real OS pid so it can poll for liveness after the
// promise resolves, so we wrap spawn to record each child as it's created.
// vi.spyOn can't target this directly — named exports of a built-in ESM
// module are non-configurable — so vi.mock (which replaces the whole
// module) is used instead; it forwards every call straight to the real
// spawn, so it doesn't change behavior for the other tests in this file.
const spawnedChildren: ChildProcess[] = [];
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn((...args: Parameters<typeof actual.spawn>) => {
      const child = actual.spawn(...args);
      spawnedChildren.push(child);
      return child;
    }),
  };
});

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
    "kills a child that closed its stdin but stayed alive and ignored SIGTERM (regression)",
    async () => {
      // Closing stdin does not imply the process died — a child can close
      // its read end and keep running. The stdin-error handler must not
      // skip killChild() in that case, or the child (and, for a real
      // `claude` subprocess, its billing) keeps running forever with no
      // timeout backstop, since finish() already cleared it.
      //
      // The child closes fd 0 with fs.closeSync(0) rather than
      // process.stdin.destroy(): destroy() only tears down the JS-level
      // stream and, empirically, does not close the underlying pipe fd
      // promptly enough (verified: no EPIPE after 10s on this platform),
      // whereas closeSync(0) triggers the parent's EPIPE within ~50ms
      // while still leaving the process itself alive and running.
      const bigAgent = {
        ...agent,
        instructions: "x".repeat(512 * 1024),
      };
      const before = spawnedChildren.length;

      const result = await runAgent(bigAgent, "hello", {
        command: "node",
        args: [
          "-e",
          "require('fs').closeSync(0); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
        ],
        timeoutMs: 5_000,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("stdin error");

      const child = spawnedChildren[before];
      expect(child).toBeDefined();
      const pid = child!.pid;
      expect(typeof pid).toBe("number");

      // killChild's default grace period is 2s before it escalates to
      // SIGKILL; give it a generous margin so this isn't flaky on a
      // loaded machine.
      const deadline = Date.now() + 8_000;
      let dead = false;
      while (Date.now() < deadline) {
        try {
          process.kill(pid!, 0);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ESRCH") {
            dead = true;
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(dead).toBe(true);
    },
    15_000,
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
