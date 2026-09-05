import { spawn } from "node:child_process";
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

export function runAgent(agent: AgentRow, taskPrompt: string): Promise<RunResult> {
  const prompt = [
    agent.instructions.trim(),
    "",
    "---",
    "",
    taskPrompt.trim(),
  ].join("\n");

  return new Promise((resolve) => {
    const child = spawn("claude", buildArgs(agent), {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("error", (e) =>
      resolve({ ok: false, reason: `could not spawn claude: ${e.message}` }));
    child.on("close", (code) =>
      resolve(interpretRun(code ?? 1, stdout, stderr)));

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
