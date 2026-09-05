import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import type { AgentRow, TaskRow } from "./types.js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Copy .env.example to .env and fill it in.",
  );
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

export async function claimNextTask(): Promise<TaskRow | null> {
  const { data, error } = await supabase.rpc("claim_next_task");
  if (error) throw new Error(`claim_next_task failed: ${error.message}`);
  const rows = (data ?? []) as TaskRow[];
  return rows[0] ?? null;
}

export async function getAgent(id: string): Promise<AgentRow> {
  const { data, error } = await supabase
    .from("agents").select("*").eq("id", id).single();
  if (error) throw new Error(`getAgent failed: ${error.message}`);
  return data as AgentRow;
}

export async function countPendingDrafts(agentId: string): Promise<number> {
  const { count, error } = await supabase
    .from("drafts")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", agentId)
    .eq("status", "pending");
  if (error) throw new Error(`countPendingDrafts failed: ${error.message}`);
  return count ?? 0;
}

export async function latestDraftBody(agentId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("drafts")
    .select("body")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`latestDraftBody failed: ${error.message}`);
  return data?.[0]?.body ?? null;
}

export async function insertDraft(
  taskId: string, agentId: string, body: string, dryRun: boolean,
): Promise<void> {
  const table = dryRun ? "drafts_dryrun" : "drafts";
  const { error } = await supabase
    .from(table)
    .insert({ task_id: taskId, agent_id: agentId, body });
  if (error) throw new Error(`insertDraft failed: ${error.message}`);
}

export async function finishTask(
  id: string, state: "done" | "failed", error?: string,
): Promise<void> {
  const { error: e } = await supabase
    .from("tasks")
    .update({ state, error: error ?? null, finished_at: new Date().toISOString() })
    .eq("id", id);
  if (e) throw new Error(`finishTask failed: ${e.message}`);
}

export async function logEvent(
  kind: string,
  detail: Record<string, unknown>,
  agentId?: string,
  taskId?: string,
): Promise<void> {
  const { error } = await supabase
    .from("events")
    .insert({ kind, detail, agent_id: agentId ?? null, task_id: taskId ?? null });
  if (error) throw new Error(`logEvent failed: ${error.message}`);
}
