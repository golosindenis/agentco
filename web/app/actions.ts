"use server";

/**
 * The dashboard's four mutations. Each one is a thin wrapper: the actual
 * work is `recordVerdict` (src/review.ts) or `markPosted` (src/db.ts) —
 * this file only pulls fields out of a submitted <form>, validates what the
 * spec requires (a decline needs a non-empty reason, see below), and
 * revalidates the page afterwards so the server-rendered lists reflect the
 * write immediately.
 *
 * Nothing here touches SUPABASE_SERVICE_ROLE_KEY directly — `buildLiveReviewDeps`
 * and the functions imported from `../../src/db.js` are the only things that
 * do, and both run exclusively on the server (this file has no "use client"
 * export, and Next never ships a "use server" action's body to the browser,
 * only a reference to call it).
 *
 * Every exported action below calls `requireAuthorizedUser()` first, before
 * touching anything else — including `approveDraftWithEdit`'s call to
 * `updateDraftBody`, which happens before its own `recordAndRevalidate`.
 * This does not lean on `web/middleware.ts` covering the route: Server
 * Actions are callable directly and are expected to authorize themselves
 * (https://nextjs.org/docs/app/building-your-application/authentication#server-actions),
 * so the matcher in `web/middleware.ts` is defense in depth here, not the
 * only thing standing between an unallowed session and a live write.
 */
import { revalidatePath } from "next/cache";
import { recordVerdict, buildLiveReviewDeps } from "../../src/review.js";
import { getDraftForReview, markPosted, updateDraftBody } from "../../src/db.js";
import type { Verdict } from "../../src/types.js";
import { currentUser } from "./lib/supabaseServer";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * The single place every mutation below checks who's calling. Returns a
 * ready-to-return `ActionResult` failure when the caller isn't the allowed,
 * signed-in user, or `null` when it's safe to proceed — never throws, so
 * callers can `if (unauthorized) return unauthorized;` and keep the same
 * failure shape the rest of this file already uses.
 */
async function requireAuthorizedUser(): Promise<ActionResult | null> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Not authorized." };
  return null;
}

/**
 * Guards every verdict-issuing mutation (approveDraft, approveDraftWithEdit,
 * declineDraft) against acting on a draft that has already been decided.
 *
 * recordVerdict (src/review.ts) guards the approval row, the feedback row,
 * the instruction rule and the ladder move behind its own `hasApproval`
 * check, but its final `setDraftStatus` call runs unconditionally. So a
 * stale open page — the other layout, another tab, the CLI already having
 * decided this draft — submitting a *different* verdict can still flip
 * `drafts.status` with no approval row, no ladder move, and (on a decline)
 * silently drop the typed reason: no feedback row, no instruction rule, even
 * though the UI promises "This becomes a standing rule for the agent."
 * Fixing that ordering inside recordVerdict is out of scope here (src/ is
 * frozen for this change); re-reading the draft's current status before any
 * verdict path runs closes the same hole at the platform layer instead.
 *
 * Called both from `recordAndRevalidate` (covers approveDraft, declineDraft,
 * and the tail of approveDraftWithEdit) and directly at the top of
 * approveDraftWithEdit's own try block, before its `updateDraftBody` call —
 * otherwise a stale edit-and-approve could still overwrite an
 * already-decided draft's body even though the verdict itself gets refused.
 */
async function requirePendingDraft(draftId: string): Promise<ActionResult | null> {
  const draft = await getDraftForReview(draftId);
  if (!draft) return { ok: false, error: "This draft no longer exists." };
  if (draft.status !== "pending") {
    return { ok: false, error: `This draft was already ${draft.status}.` };
  }
  return null;
}

async function recordAndRevalidate(
  draftId: string,
  agentId: string,
  verdict: Verdict,
  reason?: string,
): Promise<ActionResult> {
  try {
    const stale = await requirePendingDraft(draftId);
    if (stale) return stale;
    const deps = await buildLiveReviewDeps();
    await recordVerdict(deps, draftId, agentId, verdict, reason);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function approveDraft(formData: FormData): Promise<ActionResult> {
  const unauthorized = await requireAuthorizedUser();
  if (unauthorized) return unauthorized;

  const draftId = String(formData.get("draftId") ?? "");
  const agentId = String(formData.get("agentId") ?? "");
  if (!draftId || !agentId) return { ok: false, error: "Missing draft or agent id." };
  return recordAndRevalidate(draftId, agentId, "approved");
}

export async function approveDraftWithEdit(formData: FormData): Promise<ActionResult> {
  const unauthorized = await requireAuthorizedUser();
  if (unauthorized) return unauthorized;

  const draftId = String(formData.get("draftId") ?? "");
  const agentId = String(formData.get("agentId") ?? "");
  const editedBody = String(formData.get("editedBody") ?? "");
  if (!draftId || !agentId) return { ok: false, error: "Missing draft or agent id." };
  if (!editedBody.trim()) return { ok: false, error: "Edited text can't be empty." };

  try {
    const stale = await requirePendingDraft(draftId);
    if (stale) return stale;
    // The body must be saved before recordVerdict runs — recordVerdict is
    // what flips this draft's status away from "pending", and
    // approvedUnpostedDrafts / scripts/drafts.ts only ever show the body
    // that's in the row at read time. See updateDraftBody's own comment in
    // src/db.ts.
    await updateDraftBody(draftId, editedBody.trim());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return recordAndRevalidate(draftId, agentId, "approved_with_edit");
}

export async function declineDraft(formData: FormData): Promise<ActionResult> {
  const unauthorized = await requireAuthorizedUser();
  if (unauthorized) return unauthorized;

  const draftId = String(formData.get("draftId") ?? "");
  const agentId = String(formData.get("agentId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!draftId || !agentId) return { ok: false, error: "Missing draft or agent id." };
  // A decline reason is written into the agent's own instructions so the
  // correction actually sticks (see src/review.ts, appendRule). An empty
  // reason would record the decline but teach the agent nothing, silently —
  // this is enforced here as well as by the form's own `required` attribute,
  // since a form submission can bypass client-side HTML validation.
  if (!reason) return { ok: false, error: "A decline needs a one-line reason." };
  return recordAndRevalidate(draftId, agentId, "declined", reason);
}

export async function markDraftPosted(formData: FormData): Promise<ActionResult> {
  const unauthorized = await requireAuthorizedUser();
  if (unauthorized) return unauthorized;

  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "Missing draft id." };
  try {
    await markPosted(draftId);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
