import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import type { AgentRow } from "./types.js";

/**
 * Per-run cost/usage telemetry, parsed from `claude -p --output-format json`.
 * `costUsd` is a list-price equivalent (`costBasis: "list"` in the CLI's own
 * output) — Denis runs these agents on a Claude subscription, so this is
 * never a bill. It exists so an expensive agent is visible, not a surprise.
 */
export type RunUsage = {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  durationMs: number;
  numTurns: number;
  model: string | null;
};

export type RunResult =
  | { ok: true; body: string; usage: RunUsage }
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
  return [
    "--print", "--max-turns", String(agent.turn_cap),
    // JSON output is what makes usage/cost telemetry parseable at all — see
    // parseRunJson below. Verified against the installed CLI (v2.1.195).
    "--output-format", "json",
  ];
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

/** A missing/malformed numeric field becomes 0, never a throw — see the
 * comment on parseRunJson below for why that matters. */
function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Parses one `claude -p --output-format json` envelope into a draft body and
 * its usage telemetry.
 *
 * Every numeric usage field defaults to 0, and a missing model defaults to
 * null, rather than throwing — deliberately. Telemetry is a secondary
 * concern layered on top of a run that has (or hasn't) already produced a
 * usable draft; a bug or a future CLI shape change in the usage/modelUsage
 * fields must never turn an otherwise-good draft into a failed run. Only the
 * envelope's own error signal (`is_error`) or a missing/empty `result` can
 * fail this function — never an odd `usage` shape.
 */
export function parseRunJson(
  stdout: string,
): { ok: true; body: string; usage: RunUsage } | { ok: false; reason: string } {
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `claude output was not valid JSON: ${message}` };
  }

  if (typeof envelope !== "object" || envelope === null) {
    return { ok: false, reason: "claude JSON output was not an object" };
  }
  const obj = envelope as Record<string, unknown>;

  if (!("result" in obj)) {
    return { ok: false, reason: 'claude JSON output is missing "result"' };
  }

  if (obj.is_error === true) {
    const subtype = typeof obj.subtype === "string" ? obj.subtype : "unknown";
    const resultText = typeof obj.result === "string" ? obj.result.trim() : "";
    return {
      ok: false,
      reason: `claude reported an error (${subtype})${resultText ? `: ${resultText}` : ""}`,
    };
  }

  const result = obj.result;
  if (typeof result !== "string") {
    return { ok: false, reason: 'claude JSON output\'s "result" was not a string' };
  }
  const body = result.trim();
  if (body.length === 0) {
    return { ok: false, reason: 'claude JSON output\'s "result" was empty' };
  }

  const usageRaw = obj.usage && typeof obj.usage === "object"
    ? obj.usage as Record<string, unknown> : {};
  const modelUsage = obj.modelUsage && typeof obj.modelUsage === "object"
    ? obj.modelUsage as Record<string, unknown> : {};
  const model = Object.keys(modelUsage)[0] ?? null;

  const usage: RunUsage = {
    costUsd: num(obj.total_cost_usd),
    inputTokens: num(usageRaw.input_tokens),
    outputTokens: num(usageRaw.output_tokens),
    cacheReadTokens: num(usageRaw.cache_read_input_tokens),
    cacheCreationTokens: num(usageRaw.cache_creation_input_tokens),
    durationMs: num(obj.duration_ms),
    numTurns: num(obj.num_turns),
    model,
  };

  return { ok: true, body, usage };
}

export function interpretRun(
  code: number, stdout: string, stderr: string,
): RunResult {
  if (code !== 0) {
    return { ok: false, reason: `claude exited ${code}: ${stderr.trim()}` };
  }
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "claude exited 0 but produced no output" };
  }
  const parsed = parseRunJson(stdout);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }
  return { ok: true, body: parsed.body, usage: parsed.usage };
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
