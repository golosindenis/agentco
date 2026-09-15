import { supabase } from "../db.js";
import { STUCK_AFTER_MS } from "./publish.js";
import type { AccountRow, AccountStatus, Platform, PostRow, PublishResult } from "./types.js";

export type NewPost = Pick<PostRow, "source_kind" | "source_id" | "account_id" | "platform" | "caption" | "image_paths" | "scheduled_for">;
export type ShotEntry = { date: string; subject: string; angle: string; shot: string };

const ACCOUNT_FIELDS = "id, platform, handle, external_id, status, reason, token_expires_at";

function check(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export async function listAccounts(): Promise<AccountRow[]> {
  const { data, error } = await supabase.from("social_accounts").select(ACCOUNT_FIELDS).order("handle");
  check(error, "listAccounts");
  return (data ?? []) as AccountRow[];
}

export async function getAccount(id: string): Promise<AccountRow | null> {
  const { data, error } = await supabase.from("social_accounts").select(ACCOUNT_FIELDS).eq("id", id).maybeSingle();
  check(error, `getAccount(${id})`);
  return (data as AccountRow | null) ?? null;
}

export async function upsertAccount(a: {
  platform: Platform; handle: string; external_id: string; status: AccountStatus; reason: string | null;
}): Promise<string> {
  const { data, error } = await supabase.from("social_accounts")
    .upsert({ ...a, updated_at: new Date().toISOString() }, { onConflict: "platform,external_id" })
    .select("id").single();
  check(error, "upsertAccount");
  return (data as { id: string }).id;
}

export async function setAccountToken(id: string, token: string, expiresAt: Date | null): Promise<void> {
  const { error } = await supabase.rpc("set_account_token", {
    p_account: id, p_token: token, p_expires: expiresAt ? expiresAt.toISOString() : null,
  });
  check(error, "setAccountToken");
}

export async function getAccountToken(id: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_account_token", { p_account: id });
  check(error, "getAccountToken");
  return (data as string | null) ?? null;
}

export async function markAccountReconnect(id: string, reason: string): Promise<void> {
  const { error } = await supabase.from("social_accounts")
    .update({ status: "reconnect_needed", reason, updated_at: new Date().toISOString() }).eq("id", id);
  check(error, "markAccountReconnect");
}

export async function claimDuePosts(limit: number): Promise<PostRow[]> {
  const { data, error } = await supabase.rpc("claim_due_posts", { p_limit: limit });
  check(error, "claimDuePosts");
  return (data ?? []) as PostRow[];
}

export async function failStuckPosts(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS).toISOString();
  const { data, error } = await supabase.from("posts")
    .update({ status: "failed", error: "Publish did not complete. Check the account before retrying, it may have posted." })
    .eq("status", "posting").lt("claimed_at", cutoff).select("id");
  check(error, "failStuckPosts");
  return (data ?? []).length;
}

export async function markPostPosted(id: string, r: PublishResult): Promise<void> {
  const { error } = await supabase.from("posts").update({
    status: "posted", external_id: r.externalId, permalink: r.permalink, error: null, posted_at: new Date().toISOString(),
  }).eq("id", id);
  check(error, "markPostPosted");
}

export async function markPostFailed(id: string, message: string): Promise<void> {
  const { error } = await supabase.from("posts").update({ status: "failed", error: message }).eq("id", id);
  check(error, "markPostFailed");
}

export async function insertPosts(rows: NewPost[]): Promise<void> {
  const { error } = await supabase.from("posts").insert(rows);
  check(error, "insertPosts");
}

export async function postsForSource(kind: "draft" | "carousel", id: string): Promise<PostRow[]> {
  const { data, error } = await supabase.from("posts").select("*")
    .eq("source_kind", kind).eq("source_id", id).order("scheduled_for");
  check(error, "postsForSource");
  return (data ?? []) as PostRow[];
}

/** Only a row still waiting can be cancelled. Returns whether it was. */
export async function cancelPost(id: string): Promise<boolean> {
  const { data, error } = await supabase.from("posts").update({ status: "cancelled" })
    .eq("id", id).eq("status", "scheduled").select("id");
  check(error, "cancelPost");
  return (data ?? []).length === 1;
}

/** A failed row goes back in the queue for the next tick. Returns whether it did. */
export async function retryPost(id: string): Promise<boolean> {
  const { data, error } = await supabase.from("posts")
    .update({ status: "scheduled", error: null, scheduled_for: new Date().toISOString() })
    .eq("id", id).eq("status", "failed").select("id");
  check(error, "retryPost");
  return (data ?? []).length === 1;
}

export async function instagramTimes(accountId: string): Promise<Date[]> {
  const { data, error } = await supabase.from("posts").select("scheduled_for, posted_at")
    .eq("account_id", accountId).eq("platform", "instagram").in("status", ["scheduled", "posting", "posted"]);
  check(error, "instagramTimes");
  return (data ?? []).map((r) => new Date((r.posted_at ?? r.scheduled_for) as string));
}

/** Post images live in two buckets: carousel slides and uploaded photos. The path prefix says which. */
export async function signPostImages(paths: string[]): Promise<string[]> {
  const urls: string[] = [];
  for (const p of paths) {
    const [bucket, ...rest] = p.split(":");
    const { data, error } = await supabase.storage.from(rest.length ? bucket! : "carousels")
      .createSignedUrl(rest.length ? rest.join(":") : p, 3600);
    check(error, `signPostImages(${p})`);
    urls.push(data!.signedUrl);
  }
  return urls;
}

export async function photoForDay(day: string): Promise<string | null> {
  const { data, error } = await supabase.from("photos").select("path").eq("day", day).maybeSingle();
  check(error, "photoForDay");
  return (data?.path as string | undefined) ?? null;
}

export async function photosForDays(days: string[]): Promise<Record<string, string>> {
  if (days.length === 0) return {};
  const { data, error } = await supabase.from("photos").select("day, path").in("day", days);
  check(error, "photosForDays");
  return Object.fromEntries((data ?? []).map((r) => [r.day as string, r.path as string]));
}

export async function upsertPhoto(day: string, path: string): Promise<void> {
  const { error } = await supabase.from("photos").upsert({ day, path }, { onConflict: "day" });
  check(error, "upsertPhoto");
}

export async function createPhotoUploadUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("photos").createSignedUploadUrl(path, { upsert: true });
  if (error || !data) throw new Error(`createPhotoUploadUrl(${path}): ${error?.message ?? "no data"}`);
  return data.signedUrl;
}

export async function signPhoto(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("photos").createSignedUrl(path, 3600);
  if (error || !data) throw new Error(`signPhoto(${path}): ${error?.message ?? "no data"}`);
  return data.signedUrl;
}

export async function insertShotList(taskId: string, weekStart: string, entries: unknown[]): Promise<void> {
  const { error } = await supabase.from("shot_lists").insert({ task_id: taskId, week_start: weekStart, entries });
  check(error, "insertShotList");
}

export async function latestShotList(): Promise<{ week_start: string; entries: ShotEntry[] } | null> {
  const { data, error } = await supabase.from("shot_lists").select("week_start, entries")
    .order("created_at", { ascending: false }).limit(1);
  check(error, "latestShotList");
  return (data?.[0] as { week_start: string; entries: ShotEntry[] } | undefined) ?? null;
}

/** Queues the Strategist's shot list unless one is already on its way. */
export async function queueShotListTask(): Promise<void> {
  const { data: agent, error: aErr } = await supabase.from("agents").select("id").eq("key", "strategist").single();
  check(aErr, "queueShotListTask agent");
  const { count, error: cErr } = await supabase.from("tasks").select("id", { count: "exact", head: true })
    .eq("kind", "shot_list").in("state", ["queued", "running"]);
  check(cErr, "queueShotListTask count");
  if ((count ?? 0) > 0) return;
  const { error } = await supabase.from("tasks").insert({ agent_id: (agent as { id: string }).id, kind: "shot_list" });
  check(error, "queueShotListTask insert");
}

export async function setDraftPhoto(draftId: string, path: string | null): Promise<void> {
  const { error } = await supabase.from("drafts").update({ photo_path: path }).eq("id", draftId);
  check(error, "setDraftPhoto");
}
