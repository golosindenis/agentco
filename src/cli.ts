import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { supabase } from "./db.js";
import { recordVerdict, buildLiveReviewDeps, countRules, MAX_RULES } from "./review.js";
import type { Verdict } from "./types.js";

const rl = readline.createInterface({ input: stdin, output: stdout });

/** EOF sentinel: stdin closed (e.g. Ctrl-D) while waiting on an answer. */
const EOF = Symbol("eof");

/**
 * rl.question() rejects if stdin closes before an answer is given. Swallow
 * that here so Ctrl-D exits the session cleanly instead of crashing with a
 * raw stack trace — nothing has been written yet for the draft in progress,
 * so it simply stays pending.
 */
async function ask(prompt: string): Promise<string | typeof EOF> {
  try {
    return await rl.question(prompt);
  } catch {
    return EOF;
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

    const next = await recordVerdict(liveReviewDeps, d.id, d.agent_id, verdict, reason);
    console.log(`Recorded. ${agent.display_name} is now level ${next.level}, streak ${next.streak}.`);

    // The instruction cap is what stops an agent's working memory turning into
    // Attune's old CLAUDE.md: corrections appended forever, nothing removed.
    if (verdict === "declined") {
      const { data: a } = await supabase
        .from("agents").select("instructions").eq("id", d.agent_id).single();
      const rules = countRules(a?.instructions ?? "");
      if (rules >= MAX_RULES) {
        console.log(
          `\n  ${agent.display_name} is at ${rules} rules (cap ${MAX_RULES}). ` +
          `Consolidate before adding more: merge duplicates and drop rules not ` +
          `violated in 30 days. The full history stays in the feedback table.`,
        );
      }
    }
    console.log("");
  }

  rl.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
