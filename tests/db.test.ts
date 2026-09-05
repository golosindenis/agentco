import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// These tests are live network round trips to Supabase (ap-northeast-2) and
// several of them make a handful of sequential calls. They run alongside
// suites that spawn real child processes, so under full-suite load the 5s
// default trips on latency rather than on anything being wrong — the suite
// passes in isolation and failed only when run with everything else. The
// timeout here is not an assertion about correctness; give it real headroom.
vi.setConfig({ testTimeout: 30_000 });


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
let approvedUnpostedDrafts: typeof import("../src/db.js")["approvedUnpostedDrafts"];
let markPosted: typeof import("../src/db.js")["markPosted"];

let agentId: string;

describe.skipIf(!hasCredentials)("db", () => {
  beforeAll(async () => {
    const db = await import("../src/db.js");
    ({
      supabase, claimNextTask, countPendingDrafts, insertDraft, finishTask,
      latestDraftBody, latestApprovedDraftBody, approvedUnpostedDrafts, markPosted,
    } = db);

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

      expect(await countPendingDrafts(agentId, false)).toBe(0);
      await insertDraft(t!.id, agentId, "A first draft body, long enough.", false);
      expect(await countPendingDrafts(agentId, false)).toBe(1);
    });

    it("returns the newest draft body", async () => {
      expect(await latestDraftBody(agentId, false)).toContain("first draft body");
    });

    it("writes dry-run output to the scratch table only, and reads it back only through the dry-run flag", async () => {
      const { data: t } = await supabase.from("tasks")
        .insert({ agent_id: agentId, kind: "daily_draft" }).select().single();

      const before = await countPendingDrafts(agentId, false);
      const dryBefore = await countPendingDrafts(agentId, true);
      await insertDraft(t!.id, agentId, "A dry run body, long enough to pass.", true);
      expect(await countPendingDrafts(agentId, false)).toBe(before);
      expect(await countPendingDrafts(agentId, true)).toBe(dryBefore + 1);
      expect(await latestDraftBody(agentId, true)).toContain("dry run body");

      const { count } = await supabase.from("drafts_dryrun")
        .select("id", { count: "exact", head: true }).eq("agent_id", agentId);
      expect(count).toBe(1);
    });
  });

  describe("latestApprovedDraftBody", () => {
    // There is deliberately no "returns null" test here. latestApprovedDraftBody
    // queries the whole database, not this suite's own agent, so a null
    // assertion only holds while no angle bank has ever been approved — it
    // passed on an empty database and broke the moment the system produced a
    // real one. The behaviour that actually matters (a daily_draft fails
    // without an approved angle bank, and never spawns an agent) is covered
    // deterministically with injected fakes in tests/worker.test.ts.

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

  describe("approvedUnpostedDrafts / markPosted", () => {
    // approvedUnpostedDrafts queries the whole database, not just this suite's
    // own agent (like latestApprovedDraftBody above), so this asserts our
    // draft is present/absent by id rather than asserting on the list's
    // length or contents overall.

    it("lists an approved draft with no posted_at, then drops it once markPosted runs", async () => {
      const { data: t } = await supabase.from("tasks")
        .insert({ agent_id: agentId, kind: "daily_draft" }).select().single();
      const { data: draft } = await supabase.from("drafts")
        .insert({
          task_id: t!.id, agent_id: agentId,
          body: "An approved, unposted draft body.", status: "approved",
        })
        .select().single();

      const before = await approvedUnpostedDrafts();
      const found = before.find((d) => d.id === draft!.id);
      expect(found).toBeDefined();
      expect(found!.body).toBe("An approved, unposted draft body.");
      expect(found!.agent).toBe("Test");

      await markPosted(draft!.id);

      const after = await approvedUnpostedDrafts();
      expect(after.some((d) => d.id === draft!.id)).toBe(false);
    });

    it("never lists a pending or declined draft", async () => {
      const { data: t } = await supabase.from("tasks")
        .insert({ agent_id: agentId, kind: "daily_draft" }).select().single();
      const { data: pending } = await supabase.from("drafts")
        .insert({ task_id: t!.id, agent_id: agentId, body: "Still pending.", status: "pending" })
        .select().single();
      const { data: declined } = await supabase.from("drafts")
        .insert({ task_id: t!.id, agent_id: agentId, body: "Declined body.", status: "declined" })
        .select().single();

      const drafts = await approvedUnpostedDrafts();
      expect(drafts.some((d) => d.id === pending!.id)).toBe(false);
      expect(drafts.some((d) => d.id === declined!.id)).toBe(false);
    });

    it("lists an approved daily_draft but never an approved weekly_angles, and markPosted still drops the daily_draft", async () => {
      const { data: dailyTask } = await supabase.from("tasks")
        .insert({ agent_id: agentId, kind: "daily_draft" }).select().single();
      const { data: dailyDraft } = await supabase.from("drafts")
        .insert({
          task_id: dailyTask!.id, agent_id: agentId,
          body: "The Writer's approved, unposted post.", status: "approved",
        })
        .select().single();

      const { data: anglesTask } = await supabase.from("tasks")
        .insert({ agent_id: agentId, kind: "weekly_angles" }).select().single();
      const { data: anglesDraft } = await supabase.from("drafts")
        .insert({
          task_id: anglesTask!.id, agent_id: agentId,
          body: "1. An approved angle bank, never posted.", status: "approved",
        })
        .select().single();

      const before = await approvedUnpostedDrafts();
      expect(before.some((d) => d.id === dailyDraft!.id)).toBe(true);
      expect(before.some((d) => d.id === anglesDraft!.id)).toBe(false);

      await markPosted(dailyDraft!.id);

      const after = await approvedUnpostedDrafts();
      expect(after.some((d) => d.id === dailyDraft!.id)).toBe(false);
      // The angle bank was never postable, so it must still be absent —
      // markPosted on the daily draft must not have touched it.
      expect(after.some((d) => d.id === anglesDraft!.id)).toBe(false);
    });
  });
});
