"use server";

import { revalidatePath } from "next/cache";
import { planPosts, type PostSource, type Selection } from "../../../src/posting/plan.js";
import { dubaiLocalToUtc } from "../../../src/posting/rules.js";
import { cancelPost, insertPosts, instagramTimes, retryPost } from "../../../src/posting/store.js";
import { currentUser } from "../lib/supabaseServer";

export type PostingResult = { ok: true } | { ok: false; error: string };

export async function schedulePosts(input: { source: PostSource; selections: Selection[]; local: string | null; draftId: string }): Promise<PostingResult> {
  try {
    if (!(await currentUser())) return { ok: false, error: "Not authorized." };
    const now = new Date();
    const when = input.local ? dubaiLocalToUtc(input.local) : now;
    const existing: Record<string, Date[]> = {};
    for (const s of input.selections) {
      if (s.platform === "instagram") existing[s.accountId] = await instagramTimes(s.accountId);
    }
    const plan = planPosts(input.source, input.selections, when, now, existing);
    if (!plan.ok) return { ok: false, error: plan.errors.join(". ") };
    await insertPosts(plan.rows);
    revalidatePath(`/drafts/${input.draftId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function cancelScheduledPost(id: string, draftId: string): Promise<PostingResult> {
  if (!(await currentUser())) return { ok: false, error: "Not authorized." };
  const done = await cancelPost(id);
  revalidatePath(`/drafts/${draftId}`);
  return done ? { ok: true } : { ok: false, error: "It already started posting or was cancelled." };
}

export async function retryFailedPost(id: string, draftId: string): Promise<PostingResult> {
  if (!(await currentUser())) return { ok: false, error: "Not authorized." };
  const done = await retryPost(id);
  revalidatePath(`/drafts/${draftId}`);
  return done ? { ok: true } : { ok: false, error: "Only a failed post can be retried." };
}
