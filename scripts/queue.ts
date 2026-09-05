/**
 * Queues one task. There is no scheduler yet, so this is how work gets in.
 *   npx tsx scripts/queue.ts <agent-key> <kind>
 * e.g. npx tsx scripts/queue.ts strategist weekly_angles
 */
import { supabase } from "../src/db.js";

const [key, kind] = process.argv.slice(2);
if (!key || !kind) {
  console.error("usage: tsx scripts/queue.ts <agent-key> <weekly_angles|daily_draft|brief>");
  process.exit(1);
}

const { data: agent, error: ae } = await supabase
  .from("agents").select("id, display_name").eq("key", key).single();
if (ae) throw new Error(`no agent with key "${key}": ${ae.message}`);

const { error } = await supabase.from("tasks").insert({ agent_id: agent.id, kind });
if (error) throw error;
console.log(`queued ${kind} for ${agent.display_name}`);
