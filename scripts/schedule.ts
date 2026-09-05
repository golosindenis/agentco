/**
 * Queues today's scheduled tasks (see src/schedule.ts), idempotently.
 *
 * Meant to run once a morning via launchd (see scripts/daily.sh and
 * launchd/com.denis.agentco.daily.plist), but launchd fires a catch-up run
 * when the Mac wakes from sleep past a missed StartCalendarInterval — so this
 * script can legitimately run more than once in one local day and must never
 * double-queue. For each task src/schedule.ts's dueOn() says is due, it skips
 * queuing when a task of that kind already exists for that agent with
 * created_at on or after the start of the current local day.
 *
 *   npx tsx scripts/schedule.ts
 *   npm run schedule
 */
import { supabase } from "../src/db.js";
import { dueOn } from "../src/schedule.js";

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

async function main(): Promise<void> {
  const now = new Date();
  const tasks = dueOn(now);
  const since = startOfLocalDay(now).toISOString();

  for (const task of tasks) {
    const { data: agent, error: agentErr } = await supabase
      .from("agents")
      .select("id, display_name")
      .eq("key", task.agentKey)
      .single();
    if (agentErr) {
      throw new Error(`no agent with key "${task.agentKey}": ${agentErr.message}`);
    }

    const { count, error: countErr } = await supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("agent_id", agent.id)
      .eq("kind", task.kind)
      .gte("created_at", since);
    if (countErr) {
      throw new Error(
        `checking for an existing ${task.kind} for ${task.agentKey} failed: ${countErr.message}`,
      );
    }

    if ((count ?? 0) > 0) {
      console.log(`skipped ${task.kind} for ${agent.display_name} (already queued today)`);
      continue;
    }

    const { error: insertErr } = await supabase
      .from("tasks")
      .insert({ agent_id: agent.id, kind: task.kind });
    if (insertErr) {
      throw new Error(`queuing ${task.kind} for ${task.agentKey} failed: ${insertErr.message}`);
    }
    console.log(`queued ${task.kind} for ${agent.display_name}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
