import { describe, it, expect, beforeAll, afterAll } from "vitest";

// src/db.ts throws at import time if SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// are missing (by design — see the brief). The Supabase project for this repo
// doesn't exist yet, so there is no `.env` here. A plain top-level import of
// "../src/db.js" would throw before describe.skipIf ever got a chance to
// skip, taking down the whole suite. So: skip the entire block up front when
// credentials are absent, and only dynamically import src/db.ts (inside
// beforeAll, after the skip has already been decided) when they are present.
// Once `.env` is filled in, this file runs for real as a live-database
// integration test — no other change needed.
const hasCredentials =
  !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase: typeof import("../src/db.js")["supabase"];
let claimNextTask: typeof import("../src/db.js")["claimNextTask"];
let countPendingDrafts: typeof import("../src/db.js")["countPendingDrafts"];
let insertDraft: typeof import("../src/db.js")["insertDraft"];
let finishTask: typeof import("../src/db.js")["finishTask"];
let latestDraftBody: typeof import("../src/db.js")["latestDraftBody"];
let latestApprovedDraftBody: typeof import("../src/db.js")["latestApprovedDraftBody"];

let agentId: string;

describe.skipIf(!hasCredentials)("db", () => {
  beforeAll(async () => {
    const db = await import("../src/db.js");
    ({ supabase, claimNextTask, countPendingDrafts, insertDraft, finishTask, latestDraftBody, latestApprovedDraftBody } = db);

    const { data, error } = await supabase
      .from("agents")
      .insert({ key: `test_${Date.now()}`, display_name: "Test", department: "Test" })
      .select().single();
    if (error) throw error;
    agentId = data.id;
  });

  afterAll(async () => {
    await supabase.from("agents").delete().eq("id", agentId);
  });

  describe("claim", () => {
    it("returns null when nothing is due", async () => {
      expect(await claimNextTask()).toBeNull();
    });

    it("claims a due task exactly once", async () => {
      const { data } = await supabase
        .from("tasks")
        .insert({ agent_id: agentId, kind: "daily_draft" })
        .select().single();

      const first = await claimNextTask();
      expect(first?.id).toBe(data!.id);
      expect(first?.state).toBe("running");

      // A second cron firing must not get the same row back.
      expect(await claimNextTask()).toBeNull();

      await finishTask(data!.id, "done");
    });

    it("does not claim a task that is not yet due", async () => {
      const future = new Date(Date.now() + 86_400_000).toISOString();
      await supabase.from("tasks")
        .insert({ agent_id: agentId, kind: "daily_draft", due_at: future });
      expect(await claimNextTask()).toBeNull();
    });
  });

  describe("drafts", () => {
    it("counts only pending drafts for the agent", async () => {
      const { data: t } = await supabase.from("tasks")
        .insert({ agent_id: agentId, kind: "daily_draft" }).select().single();

      expect(await countPendingDrafts(agentId)).toBe(0);
      await insertDraft(t!.id, agentId, "A first draft body, long enough.", false);
      expect(await countPendingDrafts(agentId)).toBe(1);
    });

    it("returns the newest draft body", async () => {
      expect(await latestDraftBody(agentId)).toContain("first draft body");
    });

    it("writes dry-run output to the scratch table only", async () => {
      const { data: t } = await supabase.from("tasks")
        .insert({ agent_id: agentId, kind: "daily_draft" }).select().single();

      const before = await countPendingDrafts(agentId);
      await insertDraft(t!.id, agentId, "A dry run body, long enough to pass.", true);
      expect(await countPendingDrafts(agentId)).toBe(before);

      const { count } = await supabase.from("drafts_dryrun")
        .select("id", { count: "exact", head: true }).eq("agent_id", agentId);
      expect(count).toBe(1);
    });
  });

  describe("latestApprovedDraftBody", () => {
    it("returns null when no draft of that kind has been approved", async () => {
      expect(await latestApprovedDraftBody("weekly_angles")).toBeNull();
    });

    it("returns the newest approved draft body for the given task kind, ignoring other kinds and statuses", async () => {
      const { data: angles } = await supabase.from("tasks")
        .insert({ agent_id: agentId, kind: "weekly_angles" }).select().single();
      const { data: draft } = await supabase.from("drafts")
        .insert({ task_id: angles!.id, agent_id: agentId, body: "1. First angle bank.", status: "pending" })
        .select().single();
      await supabase.from("drafts").update({ status: "approved" }).eq("id", draft!.id);

      // A daily_draft task's own draft must never satisfy a weekly_angles lookup.
      const { data: daily } = await supabase.from("tasks")
        .insert({ agent_id: agentId, kind: "daily_draft" }).select().single();
      await supabase.from("drafts")
        .insert({ task_id: daily!.id, agent_id: agentId, body: "An approved daily post.", status: "approved" });

      expect(await latestApprovedDraftBody("weekly_angles")).toContain("First angle bank");

      const { data: angles2 } = await supabase.from("tasks")
        .insert({ agent_id: agentId, kind: "weekly_angles" }).select().single();
      await supabase.from("drafts")
        .insert({ task_id: angles2!.id, agent_id: agentId, body: "1. Newer angle bank.", status: "approved" });

      expect(await latestApprovedDraftBody("weekly_angles")).toContain("Newer angle bank");
    });
  });
});
