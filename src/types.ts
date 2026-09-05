export type Verdict = "approved" | "approved_with_edit" | "declined";

export type AgentState = {
  level: number;
  maxLevel: number;
  streak: number;
  recent: Verdict[];
};

export type TaskKind = "weekly_angles" | "daily_draft" | "brief";
export type TaskState = "queued" | "running" | "done" | "failed";

export type TaskRow = {
  id: string;
  agent_id: string;
  kind: TaskKind;
  state: TaskState;
  due_at: string;
  error: string | null;
};

export type AgentRow = {
  id: string;
  key: string;
  display_name: string;
  department: string;
  level: number;
  max_level: number;
  streak: number;
  recent_verdicts: Verdict[];
  instructions: string;
  turn_cap: number;
  enabled: boolean;
};

export type DraftRow = {
  id: string;
  task_id: string;
  agent_id: string;
  body: string;
  status: "pending" | "approved" | "declined";
  created_at: string;
};
