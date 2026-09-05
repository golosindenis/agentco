import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
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

/**
 * Names/prefixes let through to the spawned `claude` child process.
 *
 * This is an allowlist, not a denylist of known-sensitive names, on purpose:
 * a variable added to process.env later (by us, by a dependency, by
 * dotenv/config) is excluded by default instead of leaking by default.
 * Without this, `spawn` would inherit all of `process.env` — including
 * SUPABASE_SERVICE_ROLE_KEY, loaded by src/db.ts's `dotenv/config` — and
 * hand a production database key to a child process running an arbitrary
 * agent prompt.
 */
const ENV_ALLOWLIST_KEYS = ["PATH", "HOME", "USER", "SHELL", "TERM", "LANG"];
const ENV_ALLOWLIST_PREFIXES = ["ANTHROPIC_", "CLAUDE_"];

/**
 * Builds the environment for the spawned `claude` child from an allowlist,
 * rather than inheriting the parent's `process.env` wholesale.
 *
 * HOME stays on the allowlist deliberately, even though it is also how the
 * child inherits the user's global Claude config, plugins, and every
 * configured MCP server (Supabase, GitHub, Vercel, computer use, ...): the
 * agent's skills live under HOME too, and dropping it would break skill
 * loading entirely. That trade-off is accepted here, not eliminated —
 * restricting which MCP servers/tools the spawned CLI can use needs
 * CLI flags verified against the installed `claude` binary, which is
 * separate, not-yet-done work.
 */
export function buildChildEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST_KEYS) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (ENV_ALLOWLIST_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      env[key] = value;
    }
  }
  return env;
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
      // Cron's cwd may be the repo root, where .env lives — don't start the
      // child there. tmpdir() keeps it out of the repo entirely.
      cwd: tmpdir(),
      env: buildChildEnv(),
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
