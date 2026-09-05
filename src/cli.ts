import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { supabase } from "./db.js";
import { recordVerdict, buildLiveReviewDeps, MAX_RULES } from "./review.js";
import type { Verdict } from "./types.js";

const rl = readline.createInterface({ input: stdin, output: stdout });

/**
 * `Interface` does carry a `closed` flag at runtime (set just before it
 * emits `"close"`), but it isn't part of the typed public API in
 * @types/node, so it can't be read directly without an unsafe cast. The
 * documented, typed `"close"` event carries the same information — it fires
 * exactly when the interface transitions to closed — so a local flag kept
 * in sync with that event is the reliable, type-safe stand-in.
 */
let interfaceClosed = false;
rl.on("close", () => { interfaceClosed = true; });

/** EOF sentinel: stdin closed (e.g. Ctrl-D) while waiting on an answer. */
const EOF = Symbol("eof");

/**
 * rl.question() rejects if stdin closes before an answer is given. That
 * covers a clean exit (Ctrl-D, or the input stream ending) — nothing has
 * been written yet for the draft in progress, so it simply stays pending —
 * but it also covers a genuine stdin fault (broken pipe, TTY error), which
 * must not be disguised as the same clean exit.
 *
 * The two are told apart via `interfaceClosed`: readline closes the
 * interface itself as part of the clean-exit path (natural EOF, or an
 * explicit close()), emitting `"close"` synchronously as it does, so by the
 * time a rejection reaches this catch block, `interfaceClosed` is true only
 * on that path. A rejection while the interface is still open is a real
 * fault, not a close, and is logged and surfaced as a non-zero exit instead
 * of a quiet "input closed" message.
 */
async function ask(prompt: string): Promise<string | typeof EOF> {
  try {
    return await rl.question(prompt);
  } catch (err) {
    if (interfaceClosed) return EOF;
    console.error("stdin failed while waiting for input:", err);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const liveReviewDeps = await buildLiveReviewDeps();

  const { data, error } = await supabase
    .from("drafts")
    .select("id, agent_id, body, created_at, agents(display_name, level)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const drafts = data ?? [];
  if (drafts.length === 0) {
    console.log("\nNothing waiting on you.\n");
    rl.close();
    return;
  }

  console.log(`\n${drafts.length} draft(s) waiting.\n`);

  for (const d of drafts) {
    const agent = d.agents as unknown as { display_name: string; level: number };
    console.log("─".repeat(64));
    console.log(`${agent.display_name}  ·  level ${agent.level}`);
    console.log("─".repeat(64));
    console.log(`\n${d.body}\n`);

    const rawAnswer = await ask("[a]pprove  [e]dited  [d]ecline  [s]kip > ");
    if (rawAnswer === EOF) {
      console.log("\nInput closed. Exiting — this draft is left pending.\n");
      return;
    }
    const answer = rawAnswer.trim().toLowerCase();

    if (answer === "s" || answer === "") continue;

    const verdict: Verdict | null =
      answer === "a" ? "approved" :
      answer === "e" ? "approved_with_edit" :
      answer === "d" ? "declined" : null;

    if (!verdict) {
      console.log("Not a valid choice. Skipping this draft.\n");
      continue;
    }

    let reason: string | undefined;
    if (verdict === "declined") {
      const rawReason = await ask("One line — what was wrong? > ");
      if (rawReason === EOF) {
        console.log("\nInput closed. Exiting — this draft is left pending.\n");
        return;
      }
      reason = rawReason.trim();
      if (!reason) {
        console.log("A decline needs a reason, or the agent learns nothing. Skipping.\n");
        continue;
      }
    }

    const result = await recordVerdict(liveReviewDeps, d.id, d.agent_id, verdict, reason);
    console.log(
      `Recorded. ${agent.display_name} is now level ${result.state.level}, streak ${result.state.streak}.`,
    );

    // The instruction cap is what stops an agent's working memory turning into
    // Attune's old CLAUDE.md: corrections appended forever, nothing removed.
    // recordVerdict already knows whether this decline's rule made it into
    // instructions, so the two cap situations are read straight off its
    // result instead of re-querying the agent and guessing which case fired.
    if (verdict === "declined") {
      if (!result.ruleAppended) {
        console.log(
          `\n  This correction was NOT saved to ${agent.display_name}'s instructions: ` +
          `already at the ${MAX_RULES}-rule cap. Consolidate before the next decline: ` +
          `merge duplicates and drop rules not violated in 30 days. The full history ` +
          `stays in the feedback table.`,
        );
      } else if (result.ruleCount >= MAX_RULES) {
        console.log(
          `\n  ${agent.display_name} has now reached the ${MAX_RULES}-rule cap. ` +
          `The next correction will be dropped unless you consolidate: merge ` +
          `duplicates and drop rules not violated in 30 days. The full history ` +
          `stays in the feedback table.`,
        );
      }
    }
    console.log("");
  }

  rl.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
