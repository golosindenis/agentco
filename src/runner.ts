import { spawn, type ChildProcess } from "node:child_process";
import type { AgentRow } from "./types.js";

export type RunResult =
  | { ok: true; body: string }
  | { ok: false; reason: string };

/**
 * Turn cap comes from the agent row so an expensive agent can be tightened
 * without a code change. Without it, a research loop can spiral.
 *
 * --max-turns is undocumented in `claude --help` (it's registered with
 * .hideHelp() in the CLI's own option parser) but is a real, functioning
 * flag that only applies in --print mode. Confirmed by inspecting the
 * installed CLI binary's option definitions (v2.1.195).
 */
export function buildArgs(agent: Pick<AgentRow, "turn_cap">): string[] {
  return ["--print", "--max-turns", String(agent.turn_cap)];
}

export const RUN_TIMEOUT_MS = 600_000; // 10 minutes
export const MAX_OUTPUT_CHARS = 200_000;
export const KILL_GRACE_MS = 2_000;

/**
 * SIGTERM, then SIGKILL if the child is still alive after the grace period.
 * A child that ignores SIGTERM would otherwise keep running — and keep
 * spending — after we have already reported the run as over.
 */
export function killChild(
  child: ChildProcess,
  graceMs: number = KILL_GRACE_MS,
): void {
  child.kill("SIGTERM");

  const escalate = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }, graceMs);
  escalate.unref();

  child.once("exit", () => clearTimeout(escalate));
}

export function interpretRun(
  code: number, stdout: string, stderr: string,
): RunResult {
  if (code !== 0) {
    return { ok: false, reason: `claude exited ${code}: ${stderr.trim()}` };
  }
  const body = stdout.trim();
  if (body.length === 0) {
    return { ok: false, reason: "claude exited 0 but produced no output" };
  }
  return { ok: true, body };
}

export function runAgent(
  agent: AgentRow,
  taskPrompt: string,
  opts: { command?: string; args?: string[]; timeoutMs?: number } = {},
): Promise<RunResult> {
  const prompt = [
    agent.instructions.trim(),
    "",
    "---",
    "",
    taskPrompt.trim(),
  ].join("\n");

  const command = opts.command ?? "claude";
  const args = opts.args ?? buildArgs(agent);
  const timeoutMs = opts.timeoutMs ?? RUN_TIMEOUT_MS;

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let settled = false;
    let stdout = "";
    let stderr = "";
    let outputCapped = false;

    const timer = setTimeout(() => {
      killChild(child);
      finish({
        ok: false,
        reason: `${command} timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);
    timer.unref();

    function finish(result: RunResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }

    child.stdout.on("data", (d) => {
      if (outputCapped) return;
      stdout += String(d);
      if (stdout.length >= MAX_OUTPUT_CHARS) {
        outputCapped = true;
        killChild(child);
        finish({
          ok: false,
          reason: `${command} output exceeded ${MAX_OUTPUT_CHARS} chars`,
        });
      }
    });
    child.stderr.on("data", (d) => {
      if (stderr.length >= MAX_OUTPUT_CHARS) return;
      stderr += String(d);
    });
    child.on("error", (e) =>
      finish({ ok: false, reason: `could not spawn ${command}: ${e.message}` }));
    child.stdin.on("error", (e) => {
      killChild(child);
      finish({ ok: false, reason: `${command} stdin error: ${e.message}` });
    });
    child.on("close", (code) =>
      finish(interpretRun(code ?? 1, stdout, stderr)));

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
