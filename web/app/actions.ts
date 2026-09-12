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
import { parseAngles, planAngleVerdict } from "../../src/angles.js";
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
 * This began as the platform-layer half of a bug in recordVerdict
 * (src/review.ts), whose final `setDraftStatus` once ran unconditionally: a
 * stale open page — the other layout, another tab, the CLI already having
 * decided this draft — submitting a *different* verdict could flip
 * `drafts.status` with no approval row, no ladder move, and (on a decline)
 * silently drop the typed reason, even though the UI promises "This becomes
 * a standing rule for the agent." That engine bug is fixed on its own branch
 * (recordVerdict now converges on the verdict actually recorded), so this
 * guard is no longer the only thing standing between a stale tab and a lost
 * correction. It stays as defence in depth, and because refusing early gives
 * the user a clear message instead of a silently-ignored submission.
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
  opts: { makeRule?: boolean } = {},
): Promise<ActionResult> {
  try {
    const stale = await requirePendingDraft(draftId);
    if (stale) return stale;
    const deps = await buildLiveReviewDeps();
    await recordVerdict(deps, draftId, agentId, verdict, reason, opts);
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

/**
 * Submits per-angle keeps and drops from a weekly angle bank.
 *
 * One form, three possible verdicts, decided by what survived:
 *   kept everything  -> approved, body untouched
 *   kept some        -> approved_with_edit, body renumbered
 *   kept nothing     -> declined, which needs a reason like any other decline
 *
 * Reasons for dropped angles are joined into the one reason the verdict
 * carries, so the feedback row and any rule read the way a human wrote them.
 * `makeRule` is opt-in per submission: dropping a weak angle should not spend
 * one of MAX_RULES, which exist for corrections that generalise.
 */
export async function submitAngleVerdicts(formData: FormData): Promise<ActionResult> {
  const unauthorized = await requireAuthorizedUser();
  if (unauthorized) return unauthorized;

  const draftId = String(formData.get("draftId") ?? "");
  const agentId = String(formData.get("agentId") ?? "");
  const body = String(formData.get("body") ?? "");
  if (!draftId || !agentId) return { ok: false, error: "Missing draft or agent id." };

  const angles = parseAngles(body);
  if (!angles) return { ok: false, error: "This draft is not an angle bank." };

  const dropped = new Set(formData.getAll("drop").map((v) => Number(v)));
  const reasons = new Map(
    angles.map((a) => [a.n, String(formData.get(`reason-${a.n}`) ?? "")]),
  );
  const makeRule = formData.get("makeRule") === "on";

  // The three-way rule lives in src/angles.ts so it can be tested without a
  // request. This function is only the plumbing around it.
  const plan = planAngleVerdict(angles, dropped, reasons);

  if (plan.verdict === "declined" && !plan.reason) {
    return { ok: false, error: "Dropping every angle is a decline, which needs a reason." };
  }

  if (plan.body !== null) {
    try {
      const stale = await requirePendingDraft(draftId);
      if (stale) return stale;
      // Same ordering rule as approveDraftWithEdit: the body must land before
      // recordVerdict flips the status away from pending.
      await updateDraftBody(draftId, plan.body);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return recordAndRevalidate(draftId, agentId, plan.verdict, plan.reason, { makeRule });
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

/**
 * Pause or resume an agent (`agents.enabled`). Guarded the same way as
 * every mutation above — `requireAuthorizedUser()` first, before touching
 * anything else. There is no draft in play here, so `requirePendingDraft`
 * doesn't apply; `setAgentEnabled` (src/db.ts) is a plain, unconditional
 * write.
 */
export async function toggleAgentPaused(formData: FormData): Promise<ActionResult> {
  const unauthorized = await requireAuthorizedUser();
  if (unauthorized) return unauthorized;

  const agentId = String(formData.get("agentId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  if (!agentId) return { ok: false, error: "Missing agent." };
  try {
    const { setAgentEnabled } = await import("../../src/db.js");
    await setAgentEnabled(agentId, enabled);
    // "/agents" isn't a route — the only page under it is the dynamic
    // "/agents/[key]", which a literal, non-dynamic revalidatePath call
    // does not match. We don't have this agent's `key` here (the form only
    // carries its id), so revalidate the dynamic page path with the `type`
    // argument instead of fetching the key just to build one concrete URL
    // (see revalidatePath's docs on route patterns + `type`). "/" also
    // needs revalidating — OverviewView.tsx renders each agent's
    // enabled/disabled state there — matching recordAndRevalidate above,
    // which revalidates "/" for the same reason.
    revalidatePath("/");
    revalidatePath("/org");
    revalidatePath("/agents/[key]", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
