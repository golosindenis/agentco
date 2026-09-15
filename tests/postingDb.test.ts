import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

const hasCredentials = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase: typeof import("../src/db.js")["supabase"];
const accountIds: string[] = [];

describe.skipIf(!hasCredentials)("posting schema", () => {
  beforeAll(async () => {
    ({ supabase } = await import("../src/db.js"));
    const { data, error } = await supabase.from("social_accounts")
      .insert({ platform: "facebook", handle: "test", external_id: `test_${Date.now()}`, status: "ready" })
      .select().single();
    if (error) throw error;
    accountIds.push(data.id);
  });

  afterAll(async () => {
    for (const id of accountIds) {
      const { data } = await supabase.from("social_accounts").select("token_secret_id").eq("id", id).single();
      await supabase.from("social_accounts").delete().eq("id", id);
      if (data?.token_secret_id) await supabase.schema("vault" as never).from("secrets").delete().eq("id", data.token_secret_id);
    }
  });

  it("stores a token in Vault and reads it back only through the function", async () => {
    const id = accountIds[0]!;
    const { error } = await supabase.rpc("set_account_token", { p_account: id, p_token: "tok_1", p_expires: null });
    expect(error).toBeNull();
    const { data } = await supabase.rpc("get_account_token", { p_account: id });
    expect(data).toBe("tok_1");
    await supabase.rpc("set_account_token", { p_account: id, p_token: "tok_2", p_expires: null });
    expect((await supabase.rpc("get_account_token", { p_account: id })).data).toBe("tok_2");
  });

  it("claims a due post exactly once and leaves future posts alone", async () => {
    const id = accountIds[0]!;
    const source = crypto.randomUUID();
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const { data: rows, error } = await supabase.from("posts").insert([
      { source_kind: "draft", source_id: source, account_id: id, platform: "facebook", caption: "due", scheduled_for: past },
      { source_kind: "draft", source_id: source, account_id: id, platform: "facebook", caption: "later", scheduled_for: future },
    ]).select();
    if (error) throw error;

    const first = await supabase.rpc("claim_due_posts", { p_limit: 50 });
    const mine = (first.data as { id: string; status: string; attempts: number }[]).filter((r) => rows!.some((x) => x.id === r.id));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.status).toBe("posting");
    expect(mine[0]!.attempts).toBe(1);

    const second = await supabase.rpc("claim_due_posts", { p_limit: 50 });
    expect((second.data as { id: string }[]).some((r) => rows!.some((x) => x.id === r.id))).toBe(false);
  });

  it("accepts a shot_list task and a draft photo_path", async () => {
    const { data: agent } = await supabase.from("agents")
      .insert({ key: `test_${Date.now()}`, display_name: "Test", department: "Test", enabled: false })
      .select().single();
    const { data: task, error } = await supabase.from("tasks").insert({ agent_id: agent!.id, kind: "shot_list" }).select().single();
    expect(error).toBeNull();
    const { data: draft, error: dErr } = await supabase.from("drafts")
      .insert({ task_id: task!.id, agent_id: agent!.id, body: "photo body long enough", photo_path: "2026-09-16/a.jpg" })
      .select("photo_path").single();
    expect(dErr).toBeNull();
    expect(draft!.photo_path).toBe("2026-09-16/a.jpg");
    await supabase.from("events").delete().eq("agent_id", agent!.id);
    await supabase.from("agents").delete().eq("id", agent!.id);
  });
});
